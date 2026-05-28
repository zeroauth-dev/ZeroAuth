package dev.zeroauth.biometric

import android.graphics.Bitmap

/**
 * The end-to-end face-to-commitment pipeline.
 *
 * Composes [FaceEmbedder] → [Quantizer] → [Sha256] → [Poseidon] →
 * [Keccak256] in order, with each stage's output fed into the next.
 * The output is a [Commitment] carrying:
 *
 *  - `did`         — the DID the platform sees. `did:zeroauth:<40 hex>`.
 *  - `value`       — the 32-byte Poseidon commitment. This is what the
 *                    server stores; verification proofs are made against
 *                    this value.
 *  - `salt`        — the 32-byte device-bound salt. Local-only; the
 *                    server never sees it.
 *  - `secret`      — the 32-byte biometric secret. Local-only; the
 *                    witness input to the Groth16 prover.
 *
 * The CLAUDE.md non-goal applies end-to-end: **raw biometric data
 * never crosses the network**. The Bitmap is processed in-process and
 * the quantised embedding is zeroed by [Sha256.digest]. The secret +
 * salt are held only long enough for the prover to consume them; the
 * caller is responsible for clearing them after the proof is built.
 *
 * # Pipeline diagram
 *
 * ```
 * Bitmap (112x112 ARGB_8888)
 *    ↓ embedder.embed
 * FloatArray (128 × float32, L2-normalised)
 *    ↓ Quantizer.quantize
 * ByteArray (256 bytes, BE int16)
 *    ↓ Sha256.digest [INPUT ZEROED HERE]
 * biometricSecret (32 bytes)
 *    ↓ saltProvider.salt
 * salt (32 bytes, Keystore-derived)
 *    ↓ Poseidon.hash2(secret, salt)
 * commitment (32 bytes, BN128 field element)
 *    ↓ Keccak256.digest, take first 20 bytes
 * did = "did:zeroauth:" + hex
 * ```
 */
class CommitmentBuilder(
    private val embedder: FaceEmbedder,
    private val saltProvider: SaltProvider,
) {

    /**
     * Run the full pipeline against [faceBitmap].
     *
     * @param faceBitmap The face crop. Caller-owned. MUST satisfy the
     *                   [FaceEmbedder.embed] preconditions (112x112,
     *                   ARGB_8888). The bitmap pixel buffer is not
     *                   stored after the embedding is computed.
     * @return A populated [Commitment]. The caller MUST clear the
     *         `secret` field via [Commitment.clearSensitive] after
     *         feeding it to the Groth16 prover.
     */
    suspend fun build(faceBitmap: Bitmap): Commitment {
        // Stage 1: face → embedding.
        val embedding = embedder.embed(faceBitmap)
        return buildFromEmbedding(embedding)
    }

    /**
     * Internal variant that takes an embedding directly. Splitting the
     * pipeline at the FaceEmbedder boundary keeps the rest of the
     * pipeline JVM-unit-testable — the test path can supply a
     * deterministic FloatArray fixture without instantiating a real
     * Bitmap. The instrumented test exercises the full [build] path
     * with a real CameraX-captured bitmap.
     */
    internal suspend fun buildFromEmbedding(embedding: FloatArray): Commitment {
        // Stage 2: embedding → quantised bytes. The Quantizer asserts
        // the L2 invariant + the 128-dim shape; we let those errors
        // propagate up so an upstream contract bug aborts enrollment.
        val quantised = Quantizer.quantize(embedding)

        // Stage 3: SHA-256 of the quantised bytes. This call ZEROES
        // `quantised` in place — the only copy of the quantised
        // embedding in memory is destroyed before we proceed.
        val secret = Sha256.digest(quantised)

        // Stage 4: pull the device-bound salt from Keystore. The
        // HMAC derivation is deterministic so this is the same value
        // every time on this device.
        val salt = saltProvider.salt()
        check(salt.size == 32) {
            "CommitmentBuilder: SaltProvider returned ${salt.size} " +
                "bytes, expected 32"
        }

        // Stage 5: Poseidon(secret, salt). The actual hash is a stub
        // in this commit (see Poseidon.kt + ADR-0019); the wiring is
        // correct end-to-end and the test harness asserts that.
        val commitment = Poseidon.hash2(secret, salt)

        // Stage 6: derive the DID. Keccak256(commitment) is the same
        // primitive Solidity uses to derive Ethereum addresses; we
        // take the first 20 bytes for the same compactness reason.
        val didSuffix = Keccak256.digest(commitment).copyOfRange(0, 20).toHex()
        val did = "did:zeroauth:$didSuffix"

        return Commitment(did = did, value = commitment, salt = salt, secret = secret)
    }

    /**
     * Hex-encode a byte array as a lower-case string.
     *
     * Hoisted as an extension here (and not into a shared util module)
     * because hex encoding is the only string manipulation we need and
     * pulling in another helper would inflate the dependency surface.
     */
    private fun ByteArray.toHex(): String {
        val sb = StringBuilder(this.size * 2)
        for (b in this) {
            val v = b.toInt() and 0xFF
            sb.append(HEX_CHARS[v ushr 4])
            sb.append(HEX_CHARS[v and 0x0F])
        }
        return sb.toString()
    }

    companion object {
        private val HEX_CHARS: CharArray = "0123456789abcdef".toCharArray()
    }
}

/**
 * The output of the commitment-building pipeline.
 *
 * Carries two public fields ([did] + [value]) and two secret fields
 * ([salt] + [secret]). The secret fields are byte arrays; the consumer
 * must call [clearSensitive] after they are no longer needed (typically
 * after the Groth16 prover has consumed the witness).
 *
 * Note that `data class` with `ByteArray` requires explicit
 * `equals` / `hashCode` — Kotlin's auto-generated versions use
 * reference identity for arrays. We use a plain `class` because
 * equality is not a meaningful operation here (two commitments are
 * the "same identity" by [did], not by full struct equality), so the
 * default Any.equals (reference identity) is the right answer.
 */
class Commitment(
    val did: String,
    val value: ByteArray,
    val salt: ByteArray,
    val secret: ByteArray,
) {
    init {
        require(value.size == 32) {
            "Commitment.value must be 32 bytes, got ${value.size}"
        }
        require(salt.size == 32) {
            "Commitment.salt must be 32 bytes, got ${salt.size}"
        }
        require(secret.size == 32) {
            "Commitment.secret must be 32 bytes, got ${secret.size}"
        }
        require(did.startsWith("did:zeroauth:")) {
            "Commitment.did must start with 'did:zeroauth:', got '$did'"
        }
    }

    /**
     * Zero the secret + salt buffers. Idempotent. Call this after the
     * Groth16 prover has consumed the secret + salt; further use of
     * those fields after [clearSensitive] returns the all-zero array.
     *
     * The `value` (commitment) and `did` are public and remain
     * readable — they are sent to the server during enrollment.
     */
    fun clearSensitive() {
        java.util.Arrays.fill(secret, 0.toByte())
        java.util.Arrays.fill(salt, 0.toByte())
    }
}
