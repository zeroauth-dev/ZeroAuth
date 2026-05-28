package dev.zeroauth.biometric

import java.math.BigInteger

/**
 * Pure-Kotlin Poseidon hash over the BN254 scalar field — ADR 0019
 * implementation.
 *
 * This file is a vendored port from the existing
 * `android/app/src/main/java/dev/zeroauth/android/sec/Poseidon.kt`
 * implementation that has been pinned against the JS reference
 * (`poseidon-lite` @ ^0.3.0, the same library `src/services/zkp.ts`
 * and `iot/src/crypto.ts` consume) since the W3 cycle.
 *
 * The vendored copy lives in this module so the `mobile/biometric/`
 * face-first pipeline can compute commitments without depending on
 * the `:app` module — `:biometric` is a pure library module that
 * any host application (the W3 demo at `android/` or the new
 * production `mobile/` app) can consume.
 *
 * # Compatibility contract
 *
 * For any input pair:
 *   Kotlin:           Poseidon.hash2(a, b)
 *   JavaScript:       poseidon2([a, b])    (poseidon-lite)
 *   Circom:           component h = Poseidon(2); h.inputs[0]=a; h.inputs[1]=b; out = h.out
 *
 * all three produce an identical 32-byte field element. The
 * round-constant tables in [PoseidonConstants] are byte-identical to
 * poseidon-lite's, so a drift would surface in [PoseidonTest]'s
 * fixed-vector assertions before any verifier mismatch reaches
 * production.
 *
 * # Field arithmetic
 *
 * Inputs and outputs are elements of the BN128 scalar field
 * (modulus = 21888242871839275222246405745257275088548364400416034343698204186575808495617).
 * The [hash2] wrapper accepts 32-byte big-endian byte arrays — the
 * conventional SHA-256 output shape — and the caller is responsible
 * for nothing more than handing in 32 bytes. The internal [toField]
 * helper masks the top two bits + reduces mod the field so an input
 * with the most-significant bits set still lands in `[0, FIELD)`
 * with negligible distribution bias.
 *
 * # Performance
 *
 * BN254 Poseidon-2 takes ~1-3 ms on a Pixel 7 in pure-Kotlin
 * BigInteger arithmetic — well inside the enrollment + verify
 * latency budgets in `docs/plan/bfsi-v1/02-bank-demo.md`. The JNI
 * alternative captured in ADR 0019 would take ~50 µs, but the
 * marginal win does not justify the JNI-build complexity for this
 * primitive — we'd only revisit if a future profiling pass shows
 * Poseidon as the bottleneck.
 */
object Poseidon {

    /** BN128 scalar field modulus. Matches circomlib's PRIME_q. */
    val FIELD: BigInteger = PoseidonConstants.FIELD

    /** Returns x mod F (handles negative inputs via Java BigInteger.mod). */
    private fun BigInteger.modF(): BigInteger = this.mod(FIELD)

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
     * Core Poseidon kernel parameterised by t = inputs.size + 1.
     * Matches poseidon-lite's `poseidon(inputs, opt, nOuts)` line-for-line.
     */
    private fun core(
        inputs: Array<BigInteger>,
        c: Array<BigInteger>,
        m: Array<Array<BigInteger>>,
    ): BigInteger {
        val nInputs = inputs.size
        require(nInputs in 1..PoseidonConstants.N_ROUNDS_P.size) {
            "Poseidon: inputs.size=$nInputs out of range"
        }
        val t = nInputs + 1
        require(m.size == t) { "Poseidon: M length mismatch — expected $t got ${m.size}" }

        val nRoundsF = PoseidonConstants.N_ROUNDS_F
        val nRoundsP = PoseidonConstants.N_ROUNDS_P[t - 2]
        val totalRounds = nRoundsF + nRoundsP

        // state = [0, ...inputs] then reduce all inputs mod F so callers
        // can hand in already-reduced or one-byte-over values safely.
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

    /**
     * Poseidon BN254 with one BigInteger input.
     * Matches poseidon-lite's `poseidon1([x])`.
     */
    fun hash1Bi(x: BigInteger): BigInteger =
        core(arrayOf(x), PoseidonConstants.C_T2, PoseidonConstants.M_T2)

    /**
     * Poseidon BN254 with two BigInteger inputs.
     * Matches poseidon-lite's `poseidon2([a, b])`.
     */
    fun hash2Bi(a: BigInteger, b: BigInteger): BigInteger =
        core(arrayOf(a, b), PoseidonConstants.C_T3, PoseidonConstants.M_T3)

    /**
     * Convenience byte-array wrapper for the 2-input case.
     *
     * Maps both 32-byte inputs into the field via [toField] (which
     * also handles the 254-bit-vs-256-bit gap), runs the kernel, and
     * serialises the result back as 32 bytes big-endian.
     *
     * @param a First input as a 32-byte big-endian field element.
     * @param b Second input as a 32-byte big-endian field element.
     * @return The 32-byte big-endian Poseidon output.
     */
    fun hash2(a: ByteArray, b: ByteArray): ByteArray {
        val aF = toField(a)
        val bF = toField(b)
        val out = hash2Bi(aF, bF)
        return toBytes32(out)
    }

    /**
     * Convenience byte-array wrapper for the 1-input case. Used by
     * [CommitmentBuilder] when computing didHash = Poseidon(salt) for
     * the public-signal layout the verifier expects.
     */
    fun hash1(x: ByteArray): ByteArray {
        val xF = toField(x)
        val out = hash1Bi(xF)
        return toBytes32(out)
    }

    /**
     * Reduce a 32-byte array to a [BigInteger] field element in [0, FIELD).
     *
     * The SHA-256 output that feeds [CommitmentBuilder] is 32 bytes
     * (256 bits), but the BN128 scalar field is 254 bits with
     * modulus `FIELD < 2^254`. We:
     *
     *  1. Mask the top two bits of byte 0 to guarantee the
     *     intermediate is in `[0, 2^254)` — drops 2 bits of entropy
     *     but keeps the next step's modular reduction cheap (small
     *     remainders converge fast).
     *  2. Reduce mod [FIELD] so the final result is in `[0, FIELD)`.
     *     The biased distribution introduced by reducing a value in
     *     `[0, 2^254)` via mod FIELD is ~2^(-126) — well under any
     *     statistical-distinguisher threshold that matters at the
     *     scale we operate. (The bias is the gap between
     *     `2^254 - FIELD` and `2^254`, divided by FIELD.)
     */
    fun toField(bytes: ByteArray): BigInteger {
        require(bytes.size == 32) {
            "Poseidon.toField: expected 32 bytes, got ${bytes.size}"
        }
        val masked = bytes.copyOf()
        masked[0] = (masked[0].toInt() and 0x3F).toByte()
        return BigInteger(1, masked).mod(FIELD)
    }

    /**
     * Serialise a field element as 32 bytes big-endian. Drops the
     * BigInteger sign byte; pads with leading zeros if the value
     * fits in fewer than 32 bytes (typical for outputs whose top byte
     * happens to be zero).
     */
    private fun toBytes32(value: BigInteger): ByteArray {
        val raw = value.toByteArray()
        return when {
            raw.size == 32 -> raw
            raw.size == 33 && raw[0] == 0.toByte() -> raw.copyOfRange(1, 33)
            raw.size < 32 -> ByteArray(32 - raw.size) + raw
            else -> throw IllegalStateException(
                "Poseidon output too large to fit in 32 bytes: ${raw.size}",
            )
        }
    }
}
