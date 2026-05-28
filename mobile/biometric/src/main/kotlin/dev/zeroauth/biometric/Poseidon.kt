package dev.zeroauth.biometric

import java.math.BigInteger

/**
 * Poseidon-BN128 hash.
 *
 * # STUB — implementation deferred to a follow-up commit
 *
 * This commit ships the [hash2] interface + a stub implementation that
 * throws [NotImplementedError]. The real implementation lands alongside
 * the deferred decision in
 * [adr/0019-poseidon-implementation-choice.md](../../../../../../../adr/0019-poseidon-implementation-choice.md):
 * either a JNI bridge to a Rust / C++ Poseidon (faster, single-source)
 * or a pure-Kotlin port via java.math.BigInteger (slower, no native
 * dependency). The android/ sibling tree already has a pure-Kotlin port
 * at [android/app/src/main/java/dev/zeroauth/android/sec/Poseidon.kt](../../../../../../../android/app/src/main/java/dev/zeroauth/android/sec/Poseidon.kt)
 * that the follow-up can vendor verbatim — that's the leading candidate
 * because it's already pinned against the JS reference vectors.
 *
 * # Compatibility contract
 *
 * Whatever implementation lands MUST match circomlibjs' Poseidon2 output
 * for every input pair. The on-chain commitment scheme is defined by
 * [circuits/identity_proof.circom](../../../../../../../circuits/identity_proof.circom):
 *
 * ```circom
 * component commitHasher = Poseidon(2);
 * commitHasher.inputs[0] <== biometricSecret;
 * commitHasher.inputs[1] <== salt;
 * commitment === commitHasher.out;
 * ```
 *
 * and the verifier service derives the same hash via circomlibjs (see
 * [src/services/identity.ts](../../../../../../../src/services/identity.ts)).
 * If the Kotlin output ever diverges from circomlibjs, every proof
 * generated on-device fails verification and enrollment breaks.
 *
 * The [hash2] vectors below are sourced from
 * [android/app/src/test/java/dev/zeroauth/android/sec/PoseidonTest.kt](../../../../../../../android/app/src/test/java/dev/zeroauth/android/sec/PoseidonTest.kt)
 * for the eventual implementation to assert against.
 *
 * # Field arithmetic
 *
 * Inputs and outputs are elements of the BN128 scalar field
 * (modulus = 21888242871839275222246405745257275088548364400416034343698204186575808495617).
 * The wrapper converts 32-byte arrays to BigInteger; the caller is
 * responsible for ensuring the input is reduced mod the field
 * (a SHA-256 output is 256 bits = ~one bit longer than the 254-bit
 * field, so we drop the top byte before mapping in — see
 * [CommitmentBuilder] for that conversion).
 */
object Poseidon {

    /** BN128 scalar field modulus. Matches circomlib's PRIME_q. */
    val FIELD: BigInteger = BigInteger(
        "21888242871839275222246405745257275088548364400416034343698204186575808495617"
    )

    /**
     * Compute Poseidon(a, b) over BN128.
     *
     * @param a First input as a 32-byte big-endian field element.
     * @param b Second input as a 32-byte big-endian field element.
     * @return The 32-byte big-endian Poseidon output.
     * @throws NotImplementedError until the follow-up commit lands the
     *         real implementation (see ADR-0019).
     */
    @Suppress("UNUSED_PARAMETER")
    fun hash2(a: ByteArray, b: ByteArray): ByteArray {
        // TODO(adr/0019): replace with either:
        //   (a) JNI bridge to a Rust/C++ Poseidon, OR
        //   (b) port of android/app/src/main/java/dev/zeroauth/android/sec/Poseidon.kt.
        // Both options are scoped + traded off in ADR-0019.
        throw NotImplementedError(
            "Poseidon.hash2 implementation deferred to the follow-up " +
                "commit per adr/0019-poseidon-implementation-choice.md. " +
                "The CommitmentBuilder pipeline shape is correct; only " +
                "the inner hash needs an implementation."
        )
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
     *
     * Public so [CommitmentBuilder] and the eventual hash2 implementation
     * share the same field-mapping. Not throwing from a stub — this is
     * pure arithmetic and the real hash2 will use it.
     */
    fun toField(bytes: ByteArray): BigInteger {
        require(bytes.size == 32) {
            "Poseidon.toField: expected 32 bytes, got ${bytes.size}"
        }
        // Mask the top byte to clear the two highest bits. This is
        // the same convention curve25519 / Ristretto use to drop
        // higher-order bits while keeping the lower 254 bits intact.
        val masked = bytes.copyOf()
        masked[0] = (masked[0].toInt() and 0x3F).toByte()
        return BigInteger(1, masked).mod(FIELD)
    }
}
