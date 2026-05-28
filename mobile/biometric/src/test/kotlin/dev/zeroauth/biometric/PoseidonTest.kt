package dev.zeroauth.biometric

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigInteger

/**
 * PoseidonTest — interface contract + stub-rejection.
 *
 * The actual Poseidon implementation is deferred to a follow-up commit
 * (see [adr/0019-poseidon-implementation-choice.md](../../../../../../../adr/0019-poseidon-implementation-choice.md)).
 * This test asserts:
 *
 *  1. The class loads (no static-init errors).
 *  2. [Poseidon.FIELD] is the BN128 scalar field modulus we expect.
 *  3. [Poseidon.toField] correctly reduces 32-byte inputs to the field.
 *  4. [Poseidon.hash2] throws NotImplementedError exactly as the stub
 *     contract promises — protecting us from someone accidentally
 *     wiring a fake implementation that returns deterministic noise.
 *
 * When the real implementation lands, the (4) test gets replaced by
 * vectors pinned against circomlibjs. The other three are forward-
 * compatible.
 */
class PoseidonTest {

    @Test
    fun `field modulus matches BN128`() {
        // From circomlib / circuits/identity_proof.circom — this is
        // the prime q of the BN128 elliptic-curve scalar group.
        val expected = BigInteger(
            "21888242871839275222246405745257275088548364400416034343698204186575808495617"
        )
        assertEquals(expected, Poseidon.FIELD)
    }

    @Test
    fun `toField maps 32 zero bytes to BigInteger zero`() {
        val zero = ByteArray(32)
        assertEquals(BigInteger.ZERO, Poseidon.toField(zero))
    }

    @Test
    fun `toField masks high bits and reduces mod FIELD`() {
        // All-0xFF input. Naively this is 2^256 - 1, which exceeds the
        // 254-bit BN128 field. The toField helper masks the top two
        // bits AND reduces mod FIELD so the output is in [0, FIELD).
        val allOnes = ByteArray(32) { 0xFF.toByte() }
        val reduced = Poseidon.toField(allOnes)
        assertTrue(
            "toField output must be non-negative",
            reduced >= BigInteger.ZERO,
        )
        assertTrue(
            "toField output must be < FIELD",
            reduced < Poseidon.FIELD,
        )
        // Specifically: ((2^254 - 1) mod FIELD) — sanity-check that
        // the function actually reduces, not just masks.
        val expectedMaskedThenReduced = BigInteger.ONE.shiftLeft(254)
            .subtract(BigInteger.ONE)
            .mod(Poseidon.FIELD)
        assertEquals(expectedMaskedThenReduced, reduced)
    }

    @Test
    fun `toField preserves a small value`() {
        // [0x00, ..., 0x00, 0x05] -> BigInteger(5).
        val five = ByteArray(32)
        five[31] = 5
        assertEquals(BigInteger.valueOf(5), Poseidon.toField(five))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `toField rejects wrong-length input`() {
        Poseidon.toField(ByteArray(16))
    }

    @Test(expected = NotImplementedError::class)
    fun `hash2 throws NotImplementedError until the real impl lands`() {
        // This test pins the stub contract — if someone adds a fake
        // implementation (e.g. SHA-256-as-Poseidon) without landing
        // ADR-0019's real choice, this fires.
        Poseidon.hash2(ByteArray(32), ByteArray(32))
    }
}
