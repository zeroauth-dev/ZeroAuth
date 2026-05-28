package dev.zeroauth.prover

/**
 * The Pramaan prover surface.
 *
 * The mobile app holds the biometricSecret + salt in memory (under the
 * StrongBox-bound key wrap) and produces a Groth16 proof binding those
 * private inputs to a session_nonce (Scene 2) or tx_nonce (Scene 3) per
 * `docs/plan/bfsi-v1/02-bank-demo.md`. The actual Groth16 computation
 * is delegated to native rapidsnark via JNI; this Kotlin interface is
 * the only seam the rest of the app sees.
 *
 * ### Contract
 *
 * @param witnessJson the canonical witness JSON shape produced by the
 *   `identity_proof.circom` v1.2 circuit (per ADR 0015). Both public
 *   and private inputs are present in this JSON. The caller is
 *   responsible for zeroing the JSON byte buffer immediately after the
 *   call returns — there is no way to do that from inside the JNI
 *   bridge.
 * @return the canonical proof JSON shape that
 *   `/v1/zkp/verify` accepts, i.e. an object with keys `pi_a`,
 *   `pi_b`, `pi_c`, `publicSignals`, `protocol`, `curve`. Encoding
 *   matches snarkjs's `groth16.fullProve` output so the server-side
 *   verifier can validate the proof without protocol bridging.
 *
 * ### Threading
 *
 * `generateProof` is a blocking call that may take 0.3–8 seconds
 * depending on whether rapidsnark or snarkjs is the backend. Callers
 * MUST invoke it on a background dispatcher; calling it on the main
 * thread will be detected by StrictMode in debug builds and crashed.
 *
 * ### Implementation map
 *
 * | Commit  | What changes |
 * |---------|--------------|
 * | C-101   | This interface + DefaultProver throwing stub. (scaffold) |
 * | C-104   | `RapidsnarkProver` backed by native rapidsnark via JNI.  |
 * | (future) | Streaming proof support for larger witness shapes.      |
 */
interface Prover {

    /**
     * Generate a Groth16 proof from a canonical witness JSON.
     *
     * @see Prover
     */
    fun generateProof(witnessJson: String): String
}

/**
 * Default [Prover] implementation — a deliberate throwing stub.
 *
 * Returned by [proverFactory] at scaffold time so the rest of the app
 * can be wired without the JNI bridge existing. Any code path that
 * actually invokes [generateProof] today will crash loudly with a
 * `NotImplementedError`; that crash is the signal that someone tried
 * to use the prover before C-104 landed.
 */
class DefaultProver : Prover {

    override fun generateProof(witnessJson: String): String {
        throw NotImplementedError("Real prover lands in C-104")
    }
}

/**
 * Module-level factory. Lifted out so :app can resolve the concrete
 * prover at scaffold time without import-coupling to either the stub
 * or (later) the real rapidsnark-backed class.
 */
fun proverFactory(): Prover = DefaultProver()
