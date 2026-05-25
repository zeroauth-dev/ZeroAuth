package dev.zeroauth.android.sec

import java.math.BigInteger

/**
 * Pure-Kotlin Poseidon hash over the BN254 scalar field.
 *
 * This is a literal port of poseidon-lite@^0.3.0
 * (https://github.com/cedoor/poseidon-lite), the same library
 * iot/src/crypto.ts and src/services/zkp.ts depend on. The port preserves
 * the canonical Hades round structure (full → partial → full) and the same
 * MDS / round-constant tables, so for any input vector
 *
 *   Kotlin:           Poseidon.hash1(x) == Poseidon.hash2(a, b) == …
 *   JavaScript:       poseidon1([x])    == poseidon2([a, b])    == …
 *
 * produces an identical BigInteger output. The Robolectric tests in
 * sec/PoseidonTest.kt and sec/AndroidKeystoreManagerTest.kt pin fixed
 * test vectors against this invariant — if the port ever drifts, those
 * tests fail loudly and proofs round-trip against the verifier break.
 *
 * ## Why a Kotlin port and not a JS bridge?
 *
 * Keystore enrollment must not depend on the WebView prover, because:
 *
 *   1. The WebView ships as a separate Android process (`:prover` per
 *      ADR-0010). Loading the WebView, parsing snarkjs.min.js, and
 *      bridging a Poseidon call back to the main process costs ~2 s and
 *      adds a renderer-IPC dependency to enrollment.
 *   2. The WebView is loaded with `connect-src 'none'` (ADR-0010) — it
 *      cannot reach the network and is not the right surface to host a
 *      pure-Kotlin call.
 *   3. ADR-0010's threat model treats the WebView as the higher-risk
 *      surface. Keeping Poseidon in main-process code means a compromised
 *      WebView cannot tamper with the commitment derivation.
 *
 * ## Why not a third-party library?
 *
 * Briefly surveyed:
 *
 *   - `io.github.zama-ai:*` — TFHE-flavoured, no Poseidon primitive.
 *   - `noir-lang/noir`'s Java bindings — pulls in JNI, ~12 MB; overkill.
 *   - iden3's `circomlibjs` — JS-only.
 *
 * A direct port of the ~70-line poseidon-lite kernel is smaller, has zero
 * runtime dependencies, and is trivially verifiable against the canonical
 * reference. The round constants live in [PoseidonConstants], regenerated
 * from poseidon-lite via the script documented in that file's header.
 */
internal object Poseidon {
    private val F: BigInteger = PoseidonConstants.FIELD

    /** Returns x mod F (handles negative inputs correctly via Java BigInteger.mod). */
    private fun BigInteger.modF(): BigInteger = this.mod(F)

    /** x^5 mod F — the Hades S-box. */
    private fun pow5(v: BigInteger): BigInteger {
        val v2 = v.multiply(v).modF()
        val v4 = v2.multiply(v2).modF()
        return v4.multiply(v).modF()
    }

    /** MDS mix: state = M * state (all arithmetic in F). */
    private fun mix(state: Array<BigInteger>, m: Array<Array<BigInteger>>): Array<BigInteger> {
        val t = state.size
        val out = Array(t) { BigInteger.ZERO }
        for (x in 0 until t) {
            var acc = BigInteger.ZERO
            for (y in 0 until t) {
                acc = acc.add(m[x][y].multiply(state[y]))
            }
            out[x] = acc.modF()
        }
        return out
    }

    /**
     * Core poseidon kernel parameterised by t = inputs.size + 1.
     * Matches poseidon-lite's `poseidon(inputs, opt, nOuts)` line-for-line.
     */
    private fun core(inputs: Array<BigInteger>, c: Array<BigInteger>, m: Array<Array<BigInteger>>): BigInteger {
        val nInputs = inputs.size
        require(nInputs in 1..PoseidonConstants.N_ROUNDS_P.size) {
            "Poseidon: inputs.size=$nInputs out of range"
        }
        val t = nInputs + 1
        require(m.size == t) { "Poseidon: M length mismatch — expected $t got ${m.size}" }

        val nRoundsF = PoseidonConstants.N_ROUNDS_F
        val nRoundsP = PoseidonConstants.N_ROUNDS_P[t - 2]
        val totalRounds = nRoundsF + nRoundsP

        // state = [0, ...inputs] then reduce all inputs mod F just in case
        // a caller hands in something already reduced or one byte over.
        var state: Array<BigInteger> = Array(t) { i ->
            if (i == 0) BigInteger.ZERO else inputs[i - 1].modF()
        }

        for (x in 0 until totalRounds) {
            // Add round constants
            for (y in 0 until t) {
                state[y] = state[y].add(c[x * t + y]).modF()
            }
            // Apply S-box. Full rounds (first nRoundsF/2 and last nRoundsF/2)
            // apply pow5 to every lane; partial rounds apply pow5 to lane 0
            // only — same conditional as poseidon-lite.
            val inFullRound = x < nRoundsF / 2 || x >= nRoundsF / 2 + nRoundsP
            if (inFullRound) {
                for (y in 0 until t) state[y] = pow5(state[y])
            } else {
                state[0] = pow5(state[0])
            }
            state = mix(state, m)
        }

        return state[0]
    }

    /** Poseidon BN254 with one input. Matches poseidon-lite's poseidon1([x]). */
    fun hash1(x: BigInteger): BigInteger =
        core(arrayOf(x), PoseidonConstants.C_T2, PoseidonConstants.M_T2)

    /** Poseidon BN254 with two inputs. Matches poseidon-lite's poseidon2([a, b]). */
    fun hash2(a: BigInteger, b: BigInteger): BigInteger =
        core(arrayOf(a, b), PoseidonConstants.C_T3, PoseidonConstants.M_T3)
}
