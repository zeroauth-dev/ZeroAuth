package dev.zeroauth.android.prover

import dev.zeroauth.android.sec.UnlockedCredential

/**
 * MobileProver — interface owned by THIS file (UI engineer).
 *
 * The concrete implementation is provided by the sibling prover-agent
 * in the W3 sprint. The agent's contract: produce a class implementing
 * this interface that runs snarkjs in a WebView (ADR-0010), feeds it
 * the witness derived from [GenerateInput], and returns the proof +
 * public signals exactly as the W2 verifier expects.
 *
 * Why the interface lives in the UI module: same reason as
 * `KeystoreManager` — the ViewModel and the Robolectric tests must
 * compile without the WebView dependency in the room. The fake
 * implementation in `util/FakeProverAndSec.kt` satisfies this contract
 * so the UI can be smoke-driven without the snarkjs bundle.
 *
 * Cryptographic protocol (Option B′ from ADR-0009):
 *
 *   1. didHashSession = Poseidon(2)([storedDidHash, sessionNonce_F])
 *   2. identityBinding = Poseidon(2)([biometricSecret, didHashSession])
 *   3. publicSignals = [commitment, didHashSession, identityBinding]
 *   4. proof = groth16.fullProve(witness, identity_proof.wasm, .zkey)
 *
 * The unchanged W2 circuit still enforces
 *   identityBinding === Poseidon(2)([biometricSecret, didHash])
 * — from the circuit's perspective the supplied `didHash` IS
 * `didHashSession`. The server re-derives the expectation and rejects
 * the proof unless `publicSignals[1]` matches.
 */
interface MobileProver {

    /**
     * Generate a Groth16 proof bound to a desktop session nonce.
     *
     * Performance: empirical 3–8 s on mid-range Android per ADR-0009.
     * The progress callback is fired by the WebView snarkjs glue at
     * roughly: 0.10 (witness derivation), 0.40 (constraint
     * satisfaction), 0.85 (groth16 prove), 1.00 (publicSignals
     * returned). The ViewModel renders these as a determinate progress
     * bar so a 5-s wait feels less abandoned.
     *
     * Throws [ProverException] with a stable `code` for the ViewModel
     * to surface as a UI error. Any throwable from the WebView itself
     * (timeout, JS error, OOM) is wrapped into ProverException with
     * code `prover_failed`.
     *
     * @param input    Decrypted credential + 31-byte session nonce hex
     * @param onProgress Optional progress callback in [0.0, 1.0].
     *                   May be invoked from a background thread.
     */
    suspend fun generate(
        input: GenerateInput,
        onProgress: (Float) -> Unit = {},
    ): GenerateOutput
}

/**
 * Witness inputs the WebView prover needs. The credential is borrowed
 * (NOT owned) — the ViewModel `close()`s it after `generate` returns
 * regardless of outcome.
 */
data class GenerateInput(
    val unlocked: UnlockedCredential,
    val sessionNonceHex: String,
)

/**
 * Output of a successful proof generation. Shape matches the W2
 * verifier's `ProveResult` so the same envelope can be serialised
 * straight into the phone→desktop QR.
 */
data class GenerateOutput(
    val proof: Groth16Proof,
    val publicSignals: List<String>,
    val did: String,
    /** Wall-clock prove time, sent in clientMeta for observability. */
    val proofMs: Long,
)

/**
 * snarkjs-shaped Groth16 proof. Field order matches `iot/src/proof.ts`
 * so the verifier deserialises this directly. Strings are decimal field
 * elements, NOT hex.
 */
data class Groth16Proof(
    val pi_a: List<String>,
    val pi_b: List<List<String>>,
    val pi_c: List<String>,
    val protocol: String = "groth16",
    val curve: String = "bn128",
)

/**
 * Phone-side prover failures. Code values are stable strings so the
 * ScanViewModel can route them to the error UI without re-mapping.
 */
class ProverException(
    val code: String,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {
    companion object {
        const val PROVER_FAILED = "prover_failed"
        const val WITNESS_INVALID = "prover_witness_invalid"
        const val WEBVIEW_CRASHED = "prover_webview_crashed"
        const val TIMEOUT = "prover_timeout"
    }
}
