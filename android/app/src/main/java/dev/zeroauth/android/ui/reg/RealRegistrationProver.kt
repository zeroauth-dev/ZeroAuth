package dev.zeroauth.android.ui.reg

import android.content.Context
import dev.zeroauth.android.prover.Groth16Proof
import dev.zeroauth.android.prover.GenerateInput
import dev.zeroauth.android.prover.IsolatedMobileProver
import dev.zeroauth.android.sec.Poseidon
import dev.zeroauth.android.sec.UnlockedCredential
import dev.zeroauth.android.ui.reg.RegistrationViewModel.ProofGenerator
import java.math.BigInteger

/**
 * Real Groth16 prover wiring for the ADR 0023 verify step.
 *
 * Builds a [RegistrationUnlockedCredential] from the per-install
 * 32-byte secret + zero salt + commitment + DID, then hands it to
 * the existing [IsolatedMobileProver] which runs snarkjs inside the
 * isolated `:prover` process per ADR 0010.
 *
 * The witness shape matches what the W3 proof-pairing flow uses, so
 * the same `identity_proof.circom` v1.2 circuit verifies registration
 * proofs without any circuit changes:
 *
 *   biometricSecret = secret as field element
 *   salt            = 0 (we don't use a salt in V1; the slot is
 *                       reserved for a future StrongBox-backed salt
 *                       per ADR 0018)
 *   commitment      = Poseidon(secret, salt)
 *   didHash         = Poseidon(commitment)  — single-arg Poseidon
 *                     so the DID is bound to the commitment in the
 *                     proof's hash chain
 *   sessionNonceHex = challenge_nonce from QR3
 *
 * The prover computes:
 *   didHashSession  = Poseidon(didHash, sessionNonce)
 *   identityBinding = Poseidon(secret, didHashSession)
 *   publicSignals   = [commitment, didHashSession, identityBinding]
 *
 * The server's verifyProofOffChain runs snarkjs.groth16.verify
 * against the boot-pinned vkey; on success the row flips to
 * `completed`. ADR 0023 §"V1 limitation" notes that publicSignals[1]
 * is NOT validated against the issued challenge_nonce — replay
 * defence comes from the single-use verify_code chain + 15-min TTL
 * + per-IP rate-limit (already in place). Circuit v1.3 in Phase 1
 * Sprint 4 will move the challenge into a circuit-bound public
 * signal.
 */
class RealRegistrationProver(
    private val context: Context,
    private val secretSource: RegistrationViewModel.BiometricSecretSource,
    private val proverFactory: () -> IsolatedMobileProver = { IsolatedMobileProver(context.applicationContext) },
) : ProofGenerator {

    override suspend fun generate(
        secret: ByteArray,
        commitmentHex: String,
        challengeNonceHex: String,
    ): Groth16Proof {
        require(secret.size == 32) { "Secret must be 32 bytes; got ${secret.size}" }

        val credential = buildCredential(secret, commitmentHex)
        val prover = proverFactory()
        try {
            val output = prover.generate(
                GenerateInput(unlocked = credential, sessionNonceHex = challengeNonceHex),
            )
            return output.proof
        } finally {
            credential.close()
            prover.release()
        }
    }

    /**
     * Build the UnlockedCredential the prover expects. All five fields
     * become decimal-string field elements snarkjs can ingest.
     *
     * `did` carries the human-form DID for logging; the field that the
     * prover actually consumes is `didHash` (the field-element form).
     */
    private fun buildCredential(secret: ByteArray, commitmentHex: String): UnlockedCredential {
        val secretField = BigInteger(1, secret)
        val saltField = BigInteger.ZERO
        val commitmentField = BigInteger(commitmentHex.removePrefix("0x"), 16)
        // Single-arg Poseidon of the commitment — binds the DID to the
        // commitment in the proof's hash chain. Cheap and stable; the
        // circuit doesn't constrain *how* didHash was derived, only
        // that the prover and verifier agree on the same value.
        val didHashField = Poseidon.hash1(commitmentField)
        val (did, _) = DeriveDidAndCommitment.from(secret)

        return RegistrationUnlockedCredential(
            biometricSecretStr = secretField.toString(10),
            saltStr = saltField.toString(10),
            commitmentStr = commitmentField.toString(10),
            didHashStr = didHashField.toString(10),
            didStr = did,
            secretBuffer = secret.copyOf(),
        )
    }
}

/**
 * UnlockedCredential subclass for the registration flow. Holds the
 * five decimal-string field elements the prover consumes. close() zeros
 * the backing byte buffer so the secret doesn't outlive the call.
 */
private class RegistrationUnlockedCredential(
    private val biometricSecretStr: String,
    private val saltStr: String,
    private val commitmentStr: String,
    private val didHashStr: String,
    private val didStr: String,
    private val secretBuffer: ByteArray,
) : UnlockedCredential() {

    @Volatile private var closed = false

    override val biometricSecret: String get() { ensureOpen(); return biometricSecretStr }
    override val salt: String get() { ensureOpen(); return saltStr }
    override val commitment: String get() { ensureOpen(); return commitmentStr }
    override val didHash: String get() { ensureOpen(); return didHashStr }
    override val did: String get() = didStr // safe even after close — non-secret

    private fun ensureOpen() {
        check(!closed) { "UnlockedCredential is closed" }
    }

    override fun close() {
        if (closed) return
        closed = true
        // Zero the buffer so the secret doesn't sit in heap longer than
        // necessary. The decimal strings are unfortunately retained by
        // the prover until its WebView call returns; the production
        // path would also clear them but that's a String-immutability
        // concession we can't fix in Kotlin without unsafe access.
        secretBuffer.fill(0)
    }
}
