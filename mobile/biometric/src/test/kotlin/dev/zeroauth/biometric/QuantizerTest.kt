package dev.zeroauth.biometric

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import kotlin.math.sqrt

/**
 * QuantizerTest — determinism + bit-stability invariants.
 *
 * The commitment derivation chain is only safe if [Quantizer.quantize]
 * is a function (same input ↔ same output) and is robust to small
 * floating-point jitter between captures of the same face. Both are
 * asserted here.
 */
class QuantizerTest {

    /** Build a deterministic 128-dim L2-normalised embedding from a seed. */
    private fun fixture(seed: Int): FloatArray {
        // The seeded LCG is deliberately weak — we don't need crypto
        // randomness in tests, we need *reproducibility*.
        var state = seed.toLong() and 0xFFFFFFFFL
        val raw = FloatArray(128) {
            // Linear congruential — same parameters as java.util.Random.
            state = (state * 0x5DEECE66DL + 0xBL) and ((1L shl 48) - 1)
            // Map to [-1, +1].
            ((state shr 16).toInt() and 0xFFFF).toFloat() / 32768.0f - 1.0f
        }
        // L2-normalise.
        var sumSq = 0.0
        for (e in raw) sumSq += (e * e).toDouble()
        val norm = sqrt(sumSq).toFloat()
        return FloatArray(128) { raw[it] / norm }
    }

    @Test
    fun `quantize is deterministic — same input maps to same output`() {
        val embedding = fixture(seed = 42)
        val a = Quantizer.quantize(embedding)
        val b = Quantizer.quantize(embedding)
        assertArrayEquals("Same input must map to identical bytes", a, b)
    }

    @Test
    fun `quantize output length is exactly 256 bytes`() {
        val embedding = fixture(seed = 7)
        val bytes = Quantizer.quantize(embedding)
        assertEquals(256, bytes.size)
    }

    @Test
    fun `quantize is stable under tiny perturbation`() {
        // Use a uniform unit vector: every component is 1/sqrt(128)
        // ≈ 0.08839. After scale × 1000, every scaled value is
        // 88.39, which rounds to 88. Distance to the nearest
        // rounding boundary (88.5) is 0.11 in scaled space =
        // 0.00011 in Float. A 1e-7 perturbation is 1000× smaller
        // than that distance, so bytes cannot change.
        //
        // The handcrafted fixture sidesteps a flake mode where a
        // random fixture happens to land a component near a boundary;
        // flake-resistance matters more than random coverage here.
        val uniform = 1.0f / sqrt(128.0).toFloat()
        val original = FloatArray(128) { uniform }
        val perturbed = FloatArray(128) { original[it] + 1e-7f }
        val a = Quantizer.quantize(original)
        val b = Quantizer.quantize(perturbed)
        assertArrayEquals(
            "1e-7 perturbation must not change quantised bytes",
            a,
            b,
        )
    }

    @Test
    fun `quantize distinguishes meaningfully different embeddings`() {
        // Two genuinely different fixtures should produce different
        // bytes — otherwise the quantiser is collapsing identities
        // and the commitment scheme leaks.
        val a = Quantizer.quantize(fixture(seed = 1))
        val b = Quantizer.quantize(fixture(seed = 99999))
        assertNotEquals(
            "Different embeddings must quantise to different bytes",
            // Comparing as hex strings — assertNotEquals on ByteArray
            // uses reference identity, which would always pass.
            a.joinToString(",") { it.toInt().and(0xFF).toString(16) },
            b.joinToString(",") { it.toInt().and(0xFF).toString(16) },
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun `quantize rejects wrong-size input`() {
        Quantizer.quantize(FloatArray(64))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `quantize rejects NaN`() {
        val embedding = fixture(seed = 0)
        embedding[5] = Float.NaN
        Quantizer.quantize(embedding)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `quantize rejects Infinity`() {
        val embedding = fixture(seed = 0)
        embedding[63] = Float.POSITIVE_INFINITY
        Quantizer.quantize(embedding)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `quantize rejects components outside the L2-normalised range`() {
        // A unit vector in 128 dimensions has every component in
        // [-1, +1] (no single dimension can exceed the L2 length).
        // Setting one component to 1.5 violates the L2-normalised
        // contract — the per-component bound rejects it.
        val embedding = FloatArray(128)
        embedding[0] = 1.5f
        Quantizer.quantize(embedding)
    }

    @Test
    fun `quantize big-endian byte order matches DataInputStream`() {
        // Build a one-hot embedding with a known component value:
        // embedding[0] = 0.001 -> scale by 1000 -> q = 1 -> bytes 0x00, 0x01.
        val embedding = FloatArray(128)
        embedding[0] = 0.001f
        // L2-normalise — this won't change a one-hot embedding's
        // unit-length status since |v| = 0.001 was deliberately low;
        // re-normalising would change the magnitude, so we hand-build
        // a unit vector instead.
        val sumSq = 0.001 * 0.001
        val norm = sqrt(sumSq).toFloat()
        for (i in embedding.indices) embedding[i] /= norm
        // After normalisation, embedding[0] = 1.0; scale 1000 -> q = 1000.
        val bytes = Quantizer.quantize(embedding)
        // BE: 1000 = 0x03E8 -> bytes 0x03, 0xE8.
        assertEquals(
            "BE high byte at index 0",
            0x03.toByte(),
            bytes[0],
        )
        assertEquals(
            "BE low byte at index 1",
            0xE8.toByte(),
            bytes[1],
        )
    }
}
