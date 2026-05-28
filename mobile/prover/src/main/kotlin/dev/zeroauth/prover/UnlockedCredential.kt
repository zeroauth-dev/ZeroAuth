package dev.zeroauth.prover

import java.math.BigInteger

/**
 * UnlockedCredential — the in-memory representation of a customer's
 * decrypted credential, used as input to [MobileProver.generate].
 *
 * Adapter type for the prover module. In the W3 reference impl this
 * lives in `dev.zeroauth.android.sec`; here we keep a parallel
 * declaration so `mobile/prover/` doesn't transitively depend on the
 * full Keystore stack. The host application (the `:mobile/:app`
 * module) constructs an UnlockedCredential from
 * `dev.zeroauth.biometric.Commitment` at the moment the operator
 * confirms the BiometricPrompt — see the wiring example in
 * `mobile/prover/README.md`.
 *
 * Fields:
 *   - `did`              — the DID string the proof is bound to
 *   - `commitment`       — Poseidon commitment as BigInteger
 *   - `biometricSecret`  — the 32-byte secret used in the commitment
 *                          (the witness private input)
 *   - `salt`             — the 32-byte salt used in the commitment
 *                          (the witness private input)
 *
 * The data class carries `clear()` for callers to explicitly zero the
 * underlying BigInteger refs once the prover returns. Java BigInteger
 * is immutable; the most we can do is drop the reference and let GC
 * reclaim. The host activity scopes the credential's lifetime to the
 * prove-and-discard window.
 */
data class UnlockedCredential(
    val did: String,
    val commitment: BigInteger,
    val biometricSecret: BigInteger,
    val salt: BigInteger,
) {
    /**
     * Hint that the credential should be released. BigInteger is
     * immutable so we can't overwrite; this signals intent and the
     * caller drops its reference.
     */
    fun clear() {
        // Intentionally a no-op — see class docstring.
    }
}
