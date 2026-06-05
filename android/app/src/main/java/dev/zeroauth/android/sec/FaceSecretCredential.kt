package dev.zeroauth.android.sec

import timber.log.Timber
import java.math.BigInteger
import java.security.MessageDigest

/**
 * Builds an [UnlockedCredential] directly from a 32-byte
 * biometric-derived secret captured by the on-device face-capture
 * composable.
 *
 * Mirrors `AndroidKeystoreManager.buildRegistrationFallbackCredential`
 * byte-for-byte — the derivation is duplicated here so the login
 * (proof-pairing) flow can produce a witness without an enrolled
 * Keystore blob OR a SharedPreferences fallback OR a BiometricPrompt
 * round-trip. This is the load-bearing seam that lets us drop the
 * legacy `BiometricGate.authenticateForProof` call site without
 * breaking publicSignals[0] equality on the server.
 *
 * Derivation (must stay aligned with `ceremony-client.ts`,
 * `DeriveDidAndCommitment.from`, and the prover's `buildPayload`):
 *
 *   biometricSecret = BigInteger(1, secret).mod(BN128_FIELD)
 *   salt            = 0
 *   commitment      = Poseidon(biometricSecret, salt)
 *   didHashRaw      = Poseidon(commitment)            // single-arg
 *   didSuffix       = sha256(commitmentHex)[0..20]
 *   did             = "did:zeroauth:face:" + didSuffix
 *
 * The single-arg `Poseidon(commitment)` is the raw didHash; the
 * prover folds that with the session nonce on the WebView side to
 * produce `didHashSession = Poseidon(didHash, nonce)` which becomes
 * the circuit's public input. The server re-derives the same
 * `Poseidon(stored_did_hash, session.nonce)` and constant-time
 * compares against publicSignals[1].
 *
 * ## Why a separate file (not a method on AndroidKeystoreManager)
 *
 * `buildRegistrationFallbackCredential` is `private` on
 * AndroidKeystoreManager because the encrypted-blob path needs to be
 * the only entry point for the production unlock flow. The login
 * face-capture path doesn't have a blob and shouldn't pretend it
 * does; exposing the derivation here keeps the dependency direction
 * clean (UI layer → sec.FaceSecretCredential → sec.Crypto / Poseidon)
 * without granting the UI layer access to KeystoreManager internals.
 *
 * The two derivations MUST stay byte-identical — any drift breaks
 * the autonomous-test path AND every real proof-pairing login. A
 * unit test (FaceSecretCredentialTest, follow-up) pins both
 * derivations against the same fixture.
 */
object FaceSecretCredential {

    /**
     * Reconstruct an [UnlockedCredential] from a 32-byte face-derived
     * secret. The returned credential owns mutable byte buffers; the
     * caller MUST invoke `close()` once the prover returns so the
     * Poseidon-derived material is zeroed.
     *
     * @throws IllegalArgumentException if `secret` is not exactly 32
     *         bytes — the BN128 field-element reduction below assumes
     *         that shape, and a wrong-sized buffer would silently
     *         produce a different commitment.
     */
    fun fromSecret(secret: ByteArray): UnlockedCredential {
        require(secret.size == 32) {
            "FaceSecretCredential.fromSecret: secret must be 32 bytes; got ${secret.size}"
        }

        // Reduce the raw 32-byte secret into the BN128 scalar field.
        // Matches DeriveDidAndCommitment.from + the registration
        // fallback path. The mod call truncates the high bits that
        // would otherwise overflow the field; the resulting value is
        // still high-entropy because the input was derived from a
        // SHA-256 digest.
        val biometricSecret = BigInteger(1, secret).mod(PoseidonConstants.FIELD)
        val salt = BigInteger.ZERO

        val commitment = Poseidon.hash2(biometricSecret, salt)
        // didHashRaw = single-arg Poseidon(commitment). Same shape
        // ceremony-client.ts::computeDidHashRaw + the WebView prover
        // expect; the prover folds this with the session nonce
        // before passing it to the circuit as didHashSession.
        val didHashRaw = Poseidon.hash1(commitment)

        // DID suffix is sha256(commitmentHex)[0:20] hex chars = 40
        // chars. Matches the V1 placeholder DeriveDidAndCommitment
        // uses; the server's
        // /^did:zeroauth:[a-z0-9_-]+:[0-9a-f]{8,80}$/ regex accepts
        // this.
        val commitmentHex = commitment.toString(16).padStart(64, '0')
        val didSuffix = MessageDigest.getInstance("SHA-256")
            .digest(commitmentHex.toByteArray(Charsets.UTF_8))
            .copyOfRange(0, 20)
            .joinToString("") { "%02x".format(it) }
        val did = "did:zeroauth:face:$didSuffix"

        Timber.tag(TAG).i(
            "face-derived credential constructed did=%s commitment=%s",
            did,
            commitmentHex.take(12) + "…",
        )

        return PersistedUnlockedCredential(
            biometricSecretBytes = Crypto.fieldToBytes32(biometricSecret),
            saltBytes = Crypto.fieldToBytes32(salt),
            commitmentBytes = Crypto.fieldToBytes32(commitment),
            didHashBytes = Crypto.fieldToBytes32(didHashRaw),
            didString = did,
        )
    }

    private const val TAG = "FaceSecretCredential"
}
