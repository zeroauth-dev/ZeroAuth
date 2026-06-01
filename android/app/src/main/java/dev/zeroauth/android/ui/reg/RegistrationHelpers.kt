package dev.zeroauth.android.ui.reg

import android.content.Context
import dev.zeroauth.android.prover.Groth16Proof
import dev.zeroauth.android.sec.Poseidon
import dev.zeroauth.android.ui.reg.RegistrationViewModel.BiometricSecretSource
import dev.zeroauth.android.ui.reg.RegistrationViewModel.ProofGenerator
import dev.zeroauth.android.ui.reg.RegistrationViewModel.ProofResult
import java.math.BigInteger
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Default biometric-secret source for the registration demo.
 *
 * Production usage will replace this with a wrapper around the
 * mobile/biometric/ FaceEmbedder pipeline:
 *
 *   FaceEmbedder.embed(bitmap)
 *     -> Quantizer.encode(embedding)   // 256 bytes int16 BE
 *     -> Sha256.digestAndZero(buffer)  // 32 bytes secret
 *
 * For the demo we generate (or load) a 32-byte secret kept in
 * SharedPreferences so a second run from the same install produces
 * the *same* commitment — without that property the verify step's
 * publicSignals[0] check would fail because step 2's commitment was
 * derived from a different secret than step 3's.
 *
 * The secret is generated via [SecureRandom] on first use and never
 * leaves this object. NEVER log the bytes; this is the closest thing
 * the demo has to a "biometric-derived secret" and it deserves the
 * same handling.
 */
class PerInstallStableSecret(context: Context) : BiometricSecretSource {

    private val prefs = context.applicationContext.getSharedPreferences(
        PREFS_NAME,
        Context.MODE_PRIVATE,
    )

    override suspend fun secret(): ByteArray {
        val existing = prefs.getString(KEY_SECRET_HEX, null)
        if (!existing.isNullOrBlank() && existing.length == 64) {
            return hexDecode(existing)
        }
        val fresh = ByteArray(32)
        SecureRandom().nextBytes(fresh)
        prefs.edit().putString(KEY_SECRET_HEX, hexEncode(fresh)).apply()
        return fresh
    }

    private companion object {
        const val PREFS_NAME = "zeroauth_reg_secret"
        const val KEY_SECRET_HEX = "secret_hex"

        fun hexEncode(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }

        fun hexDecode(hex: String): ByteArray =
            ByteArray(hex.length / 2) { i ->
                ((Character.digit(hex[i * 2], 16) shl 4)
                    + Character.digit(hex[i * 2 + 1], 16)).toByte()
            }
    }
}

/**
 * Derive `(did, commitment)` from a 32-byte biometric secret.
 *
 * Mirrors the server-side regex in `src/services/registration.ts`:
 *   - did matches `did:zeroauth:<method>:<hex>` (we use method=face)
 *   - commitment matches `(0x)?[0-9a-f]{32,128}` (we emit 64 hex chars
 *     with no `0x` prefix to keep both ends consistent)
 *
 * The commitment is `Poseidon.hash2(secret, salt)` with a zero salt
 * for V1 (the salt slot is reserved for the StrongBox-backed
 * SaltProvider in the production pipeline; the server doesn't care
 * about the salt because the server only sees the commitment). The
 * DID is `"did:zeroauth:face:" + keccak256(commitment_bytes)[:20]`
 * derived via [Poseidon]'s field-element helpers.
 *
 * Phase 1 Sprint 4 will replace this with the canonical pipeline from
 * `mobile/biometric/CommitmentBuilder.kt` which already implements
 * this derivation with the real salt + Keccak path.
 */
object DeriveDidAndCommitment {

    /**
     * BN254 / BN128 scalar field modulus. Same value as
     * [dev.zeroauth.android.sec.PoseidonConstants.FIELD] and what
     * snarkjs uses inside the WebView prover; duplicated here so the
     * mod-reduction below is obviously self-contained at the call site.
     * MUST match the constant in
     * [RealRegistrationProver]'s private companion — they are paired
     * (step 2 commitment, step 3 witness).
     */
    private val BN128_FIELD: BigInteger = BigInteger(
        "21888242871839275222246405745257275088548364400416034343698204186575808495617",
    )

    fun from(secret: ByteArray): Pair<String, String> {
        require(secret.size == 32) { "Secret must be 32 bytes; got ${secret.size}" }
        val zeroSalt = ByteArray(32)
        // Poseidon.hash2 takes BigInteger inputs (BN128 field elements).
        // Convert each 32-byte buffer to a non-negative BigInteger and
        // reduce mod the BN128 scalar field modulus — a 32-byte buffer
        // from SecureRandom can encode a value >= FIELD, which the
        // circuit + snarkjs both reject. The reduction MUST match the
        // one in RealRegistrationProver.buildCredential so step 2
        // (commit) and step 3 (verify) agree on the same field element.
        val s = BigInteger(1, secret).mod(BN128_FIELD)
        val t = BigInteger(1, zeroSalt)
        val commitmentBi = Poseidon.hash2(s, t)
        val commitmentHex = commitmentBi.toString(16).padStart(64, '0')

        // DID suffix = first 20 bytes of SHA-256 of the commitment hex
        // (placeholder for keccak256 — Phase 1 Sprint 4 swaps in the
        // BouncyCastle keccak wrapper from mobile/biometric/Keccak256.kt).
        val didSuffix = MessageDigest.getInstance("SHA-256")
            .digest(commitmentHex.toByteArray(Charsets.UTF_8))
            .copyOfRange(0, 20)
            .joinToString("") { "%02x".format(it) }

        return "did:zeroauth:face:$didSuffix" to commitmentHex
    }
}

/**
 * Default proof generator used by the demo. Produces a Groth16-shaped
 * envelope with placeholder field elements so the route plumbing can
 * be exercised — the server's `verifyProofOffChain` WILL reject it,
 * which is the intended demo outcome.
 *
 * Phase 1 Sprint 4 wires this to the existing
 * `dev.zeroauth.android.prover.WebViewMobileProver` whose
 * `generate(GenerateInput)` returns a real proof + publicSignals
 * tuple. The route adapter is a one-screen change in
 * RegistrationViewModel — `proof = realProver.generate(...).proof`.
 */
object StubProofGenerator : ProofGenerator {
    override suspend fun generate(
        secret: ByteArray,
        commitmentHex: String,
        challengeNonceHex: String,
    ): ProofResult = ProofResult(
        proof = Groth16Proof(
            pi_a = listOf("1", "2", "1"),
            pi_b = listOf(listOf("3", "4"), listOf("5", "6"), listOf("1", "0")),
            pi_c = listOf("7", "8", "1"),
        ),
        // Three-element decimal placeholder list — matches the circuit's
        // declared public-signal count (commitment, didHash,
        // identityBinding) so the server's array-length guards pass. The
        // Groth16 verifier WILL still reject these as cryptographically
        // invalid; the demo treats that as expected and surfaces a
        // "wire up the real prover" message.
        publicSignals = listOf("0", "0", "0"),
    )
}
