package dev.zeroauth.biometric

import org.junit.Test
import kotlin.math.sqrt
import kotlin.test.assertFailsWith

/**
 * FaceEmbedderTest — covers the internal pure helpers that don't need
 * a real TFLite interpreter or Android Bitmap. The full TFLite-backed
 * inference path is covered by the instrumented test in the FaceCapture
 * commit (per ADR-0018's deferred work table).
 */
class FaceEmbedderTest {

    @Test
    fun `l2Normalise produces a unit vector`() {
        // Hand-rolled non-unit vector.
        val v = floatArrayOf(3.0f, 4.0f) + FloatArray(126) { 0f }
        val n = TfliteFaceEmbedder.l2Normalise(v)
        // |[3, 4]| = 5; after normalisation [0.6, 0.8].
        kotlin.test.assertEquals(0.6f, n[0], 1e-5f)
        kotlin.test.assertEquals(0.8f, n[1], 1e-5f)
        // Sum-of-squares ≈ 1.0 modulo float epsilon.
        var sumSq = 0.0
        for (e in n) sumSq += (e * e).toDouble()
        kotlin.test.assertEquals(1.0, sumSq, 1e-5)
    }

    @Test
    fun `l2Normalise rejects the zero vector`() {
        // All-zero embedding is the pathological case — the upstream
        // model returned an empty tensor or the bitmap was all-black.
        // We refuse to normalise because (a) the math is undefined and
        // (b) the downstream quantiser would emit a stable byte
        // pattern for any zero embedding, creating a collision class
        // across distinct subjects.
        assertFailsWith<IllegalArgumentException> {
            TfliteFaceEmbedder.l2Normalise(FloatArray(128))
        }
    }

    @Test
    fun `l2Normalise is idempotent on already-normalised input`() {
        // Build a unit vector via two-step normalisation.
        val raw = FloatArray(128) { i -> (i + 1).toFloat() }
        var sumSq = 0.0
        for (e in raw) sumSq += (e * e).toDouble()
        val norm = sqrt(sumSq).toFloat()
        val once = FloatArray(128) { raw[it] / norm }
        val twice = TfliteFaceEmbedder.l2Normalise(once)
        // Idempotency under float arithmetic — every component agrees
        // to within 1e-5 (the float epsilon for ~unit-magnitude values).
        for (i in 0 until 128) {
            kotlin.test.assertEquals(once[i], twice[i], 1e-5f)
        }
    }

    @Test
    fun `l2Normalise preserves orientation`() {
        // Negative components stay negative after normalisation.
        val v = floatArrayOf(-3.0f, 4.0f) + FloatArray(126) { 0f }
        val n = TfliteFaceEmbedder.l2Normalise(v)
        kotlin.test.assertEquals(-0.6f, n[0], 1e-5f)
        kotlin.test.assertEquals(0.8f, n[1], 1e-5f)
    }

    @Test
    fun `embedding dim constant matches MobileFaceNet IO contract`() {
        // Pinned for IO compatibility — see assets/MODEL.md. If a
        // future model is swapped in (e.g. 256-d ArcFace), the
        // commitment chain's quantiser output length changes
        // accordingly and this test fires to call attention to the
        // breakage.
        kotlin.test.assertEquals(128, TfliteFaceEmbedder.EMBEDDING_DIM)
        kotlin.test.assertEquals(112, TfliteFaceEmbedder.INPUT_SIZE)
    }
}
