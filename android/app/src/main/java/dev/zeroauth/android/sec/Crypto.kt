package dev.zeroauth.android.sec

import java.math.BigInteger
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Locale

/**
 * Patent-Claim-3 commitment derivation — Kotlin twin of iot/src/crypto.ts.
 *
 * The construction must be bit-identical to the iot bridge and the
 * verifier server, because the W2 circuit hard-codes
 * `commitment === Poseidon(biometricSecret, salt)` and
 * `identityBinding === Poseidon(biometricSecret, didHash)`. A drift in
 * the field-element convention here makes every proof reject server-side.
 *
 *   biometricID      = SHA-256(template)               // 32 B
 *   biometricSecret  = Poseidon(biometricID_F, salt)   // BN254 scalar
 *   commitment       = Poseidon(biometricSecret, salt)
 *   didHash          = Poseidon(SHA-256(did)_F)
 *   identityBinding  = Poseidon(biometricSecret, didHash)
 *
 * The 31-byte field-element truncation is the same trick iot uses to
 * keep inputs strictly inside the BN254 scalar field (2^248 < p < 2^254)
 * without modular-reduction bias.
 *
 * ADR-0009's protocol layers one more step on top:
 *
 *   didHashSession   = Poseidon(didHash, sessionNonce_F)
 *
 * That step is also exposed here so the prover-glue agent can call it
 * directly when wiring the WebView submission.
 */
internal object Crypto {
    /** BN254 scalar field modulus. Re-exported for callers; same as PoseidonConstants.FIELD. */
    val FIELD: BigInteger = PoseidonConstants.FIELD

    /** Number of bytes consumed by [toFieldElement]. Pinned at 31 — see file header. */
    const val FIELD_BYTES: Int = 31

    /**
     * Truncate a buffer to its first 31 bytes (big-endian) and read as a
     * positive BigInteger.
     *
     * Mirrors `toFieldElement` in iot/src/crypto.ts. The 31-byte cap means
     * the value is strictly < 2^248 < FIELD, so no modular-reduction bias.
     *
     * Throws if the buffer has fewer than 31 bytes — same fail-fast as
     * the iot bridge. Inputs shorter than 31 bytes are a contract error,
     * not something to silently pad.
     */
    fun toFieldElement(buf: ByteArray): BigInteger {
        require(buf.size >= FIELD_BYTES) {
            "toFieldElement: buffer too short (${buf.size} bytes; need ≥ $FIELD_BYTES)"
        }
        val trimmed = ByteArray(FIELD_BYTES)
        System.arraycopy(buf, 0, trimmed, 0, FIELD_BYTES)
        // 1 = positive sign — BigInteger(byteArray) treats high bit as sign, which
        // would flip values ≥ 2^247 negative. We force positive interpretation.
        return BigInteger(1, trimmed)
    }

    /**
     * Generate a fresh 31-byte salt and read it as a field element. Uses
     * [SecureRandom] under the hood — on Android this is backed by
     * /dev/urandom + /dev/random as appropriate.
     */
    fun randomSalt(rng: SecureRandom = SecureRandom()): BigInteger {
        val buf = ByteArray(FIELD_BYTES)
        rng.nextBytes(buf)
        return toFieldElement(buf)
    }

    /**
     * Generate a fresh 32-byte biometric "template" buffer. For the demo
     * the phone does not own a fingerprint sensor — biometric authentication
     * is BiometricPrompt-mediated and the template that feeds the
     * commitment is a per-account high-entropy random buffer wrapped under
     * a biometric-bound Keystore key. The randomness substitutes for the
     * stable sensor template that the iot bridge derives from the R307.
     *
     * Returning ByteArray rather than the field element directly lets the
     * caller hash, persist, or zero out the bytes explicitly. The caller
     * is responsible for [ByteArray.fill]ing this buffer with zeros once
     * the derived values have been computed.
     */
    fun randomTemplate(rng: SecureRandom = SecureRandom(), bytes: Int = 32): ByteArray {
        require(bytes >= FIELD_BYTES) { "randomTemplate: bytes < FIELD_BYTES" }
        val buf = ByteArray(bytes)
        rng.nextBytes(buf)
        return buf
    }

    /** SHA-256(buf). */
    fun sha256(buf: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(buf)

    /** SHA-256(utf8(str)). */
    fun sha256Utf8(str: String): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(str.toByteArray(Charsets.UTF_8))

    /** Hex-encode a ByteArray. Lower-case, no separators. */
    fun hex(buf: ByteArray): String =
        buf.joinToString("") { "%02x".format(it) }

    /** Decode a lower- or upper-case hex string into bytes. */
    fun unhex(s: String): ByteArray {
        require(s.length % 2 == 0) { "unhex: odd length string" }
        val out = ByteArray(s.length / 2)
        for (i in out.indices) {
            val hi = Character.digit(s[i * 2], 16)
            val lo = Character.digit(s[i * 2 + 1], 16)
            require(hi >= 0 && lo >= 0) { "unhex: invalid character at $i" }
            out[i] = ((hi shl 4) or lo).toByte()
        }
        return out
    }

    /**
     * Convert a BN254 field element to a 32-byte big-endian buffer.
     * Used by [AndroidKeystoreManager] to lay out the encrypted blob.
     */
    fun fieldToBytes32(n: BigInteger): ByteArray {
        require(n.signum() >= 0) { "fieldToBytes32: negative input" }
        val bytes = ByteArray(32)
        val raw = n.toByteArray()
        // BigInteger.toByteArray() emits a sign byte for positive values
        // with high bit set — strip it.
        val srcOffset = if (raw.size == 33 && raw[0] == 0.toByte()) 1 else 0
        val srcLen = raw.size - srcOffset
        require(srcLen <= 32) { "fieldToBytes32: value larger than 32 bytes" }
        System.arraycopy(raw, srcOffset, bytes, 32 - srcLen, srcLen)
        return bytes
    }

    /** Patent step 1: biometricID = SHA-256(template). */
    fun biometricId(templateBytes: ByteArray): ByteArray = sha256(templateBytes)

    /** Patent step 4: biometricSecret = Poseidon(biometricID_F, salt). */
    fun deriveBiometricSecret(biometricId: ByteArray, salt: BigInteger): BigInteger =
        Poseidon.hash2(toFieldElement(biometricId), salt)

    /** Patent step 5: commitment = Poseidon(biometricSecret, salt). */
    fun computeCommitment(biometricSecret: BigInteger, salt: BigInteger): BigInteger =
        Poseidon.hash2(biometricSecret, salt)

    /**
     * DID identifier — stable per email. Public input, fine to derive locally.
     * Mirrors `deriveDid` in iot/src/crypto.ts: lower-case, trim, hash, take
     * first 32 hex characters, prefix with the demo DID method.
     */
    fun deriveDid(email: String): String {
        val sha = sha256Utf8(email.trim().lowercase(Locale.ROOT))
        val suffix = hex(sha).substring(0, 32)
        return "did:zeroauth:demo:$suffix"
    }

    /** Patent step 6: didHash = Poseidon(SHA-256(did)_F). One-input Poseidon. */
    fun computeDidHash(did: String): BigInteger =
        Poseidon.hash1(toFieldElement(sha256Utf8(did)))

    /** Circuit step 2: identityBinding = Poseidon(biometricSecret, didHash). */
    fun computeIdentityBinding(biometricSecret: BigInteger, didHash: BigInteger): BigInteger =
        Poseidon.hash2(biometricSecret, didHash)

    /**
     * ADR-0009 Option B′: bind a session nonce into didHash before the
     * circuit consumes it. The phone uses `didHashSession` as the circuit's
     * `didHash` public input; the server recomputes the same value from
     * `(user.didHash, session.nonce)` and constant-time-compares against
     * publicSignals[1].
     */
    fun computeDidHashSession(didHash: BigInteger, nonceField: BigInteger): BigInteger =
        Poseidon.hash2(didHash, nonceField)
}

/**
 * Helper extension — best-effort secret zeroing.
 *
 * The JVM does not guarantee that overwriting a ByteArray erases every
 * physical copy (object pools, escape-analysis copies, etc.), but for the
 * common case of an in-process attacker scraping the heap immediately
 * after the proof completes, filling the array with zeros gets the
 * sensitive bytes out of the obvious slot. Documented as best-effort in
 * AndroidKeystoreManager.kt's class header.
 */
internal fun ByteArray.zeroize() {
    this.fill(0)
}
