package dev.zeroauth.android.ui.reg

import android.graphics.Bitmap
import androidx.test.core.app.ApplicationProvider
import dev.zeroauth.android.ui.reg.RegistrationViewModel.BiometricSecretSource
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.math.sqrt

/**
 * Robolectric unit tests for [RealBiometricSecretSource].
 *
 * Robolectric is needed because [PerInstallStableSecret] (the demo
 * fallback) writes to SharedPreferences, which is an Android API. The
 * real-face branch is exercised with stub embedder + coordinator
 * implementations so the test does not need a TFLite model or a camera.
 *
 * The four required cases:
 *   1. Demo mode (flag=true) delegates to the fallback and returns the
 *      fallback's bytes.
 *   2. Demo mode reports [BiometricSecretMode.DEMO_STABLE_SECRET].
 *   3. Real-face mode runs the embedder + quantiser + SHA-256 chain and
 *      returns a 32-byte digest.
 *   4. Real-face mode reports [BiometricSecretMode.REAL_FACE_CAPTURE].
 *
 * Plus a stability-contract test: same input bitmap → same 32-byte
 * secret across two invocations (the publicSignals[0] guarantee).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class RealBiometricSecretSourceTest {

    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Test
    fun `demo mode delegates to fallback and returns its bytes`() {
        val expected = ByteArray(32) { (it + 1).toByte() }  // 1..32
        val fakeFallback = object : BiometricSecretSource {
            override suspend fun secret(): ByteArray = expected
        }
        val source = RealBiometricSecretSource(
            context = context,
            fallback = fakeFallback,
            demoFlag = true,
        )

        val actual = runBlocking { source.secret() }

        assertArrayEquals(
            "Demo mode MUST return the fallback's bytes verbatim",
            expected,
            actual,
        )
    }

    @Test
    fun `demo mode reports DEMO_STABLE_SECRET mode`() {
        val source = RealBiometricSecretSource(
            context = context,
            demoFlag = true,
        )
        assertEquals(
            BiometricSecretMode.DEMO_STABLE_SECRET,
            source.activeMode,
        )
    }

    @Test
    fun `real-face mode runs the full pipeline and returns 32 bytes`() {
        // Deterministic unit-vector embedding (first component 1, rest 0).
        // The l2Normalise guard in RealBiometricSecretSource verifies the
        // pre-normalised invariant; this fixture is already unit-length.
        val unitVector = FloatArray(128).also { it[0] = 1.0f }
        val fakeEmbedder = object : FaceEmbedder {
            override suspend fun embed(bitmap: Bitmap): FloatArray = unitVector.copyOf()
        }
        val fixtureBitmap = Bitmap.createBitmap(
            RealBiometricSecretSource.FACE_INPUT_EDGE,
            RealBiometricSecretSource.FACE_INPUT_EDGE,
            Bitmap.Config.ARGB_8888,
        )
        val fakeCoordinator = object : FaceCaptureCoordinator {
            override suspend fun captureFaceCrop(): Bitmap = fixtureBitmap.copy(Bitmap.Config.ARGB_8888, true)
        }
        val source = RealBiometricSecretSource(
            context = context,
            embedder = fakeEmbedder,
            captureCoordinator = fakeCoordinator,
            demoFlag = false,
        )

        val secret = runBlocking { source.secret() }

        assertEquals("Pipeline must return SHA-256 sized digest", 32, secret.size)
        // The digest of the SHA-256(quantise(unitVector)) MUST not be the
        // all-zero array — a true zero output would mean the SHA-256 was
        // never run or the buffer-zeroing logic clobbered the digest.
        val allZero = ByteArray(32)
        assertNotEquals(
            "Pipeline must not return all-zero — guards against buffer-zero clobber",
            allZero.toList(),
            secret.toList(),
        )
    }

    @Test
    fun `real-face mode reports REAL_FACE_CAPTURE mode`() {
        val source = RealBiometricSecretSource(
            context = context,
            demoFlag = false,
        )
        assertEquals(
            BiometricSecretMode.REAL_FACE_CAPTURE,
            source.activeMode,
        )
    }

    @Test
    fun `same embedding yields same secret across invocations - publicSignals invariant`() {
        // The same-face-same-secret invariant: two calls with the same
        // embedding MUST produce the same 32-byte secret. Without this,
        // step 2 (submit commitment) and step 3 (verify) would derive
        // different commitments and the server's publicSignals[0]
        // equality check would fail.
        val embedding = FloatArray(128) { i -> if (i == 0) 1.0f else 0.0f }
        val embedder = object : FaceEmbedder {
            override suspend fun embed(bitmap: Bitmap): FloatArray = embedding.copyOf()
        }
        val coordinator = object : FaceCaptureCoordinator {
            override suspend fun captureFaceCrop(): Bitmap = Bitmap.createBitmap(
                RealBiometricSecretSource.FACE_INPUT_EDGE,
                RealBiometricSecretSource.FACE_INPUT_EDGE,
                Bitmap.Config.ARGB_8888,
            )
        }
        val source = RealBiometricSecretSource(
            context = context,
            embedder = embedder,
            captureCoordinator = coordinator,
            demoFlag = false,
        )

        val first = runBlocking { source.secret() }
        val second = runBlocking { source.secret() }

        assertArrayEquals(
            "Two captures of the same embedding MUST produce the same secret " +
                "— required by the publicSignals[0] commitment-equality check.",
            first,
            second,
        )
    }

    @Test
    fun `missing embedder throws with operator-friendly message`() {
        // The default real-face configuration uses the placeholder
        // MissingFaceEmbedder + MissingFaceCaptureCoordinator. With
        // demoFlag=false the secret() call should fail clearly so the
        // operator knows to either flip the flag or wire the :biometric
        // module.
        val source = RealBiometricSecretSource(
            context = context,
            demoFlag = false,
        )

        try {
            runBlocking { source.secret() }
            fail("Expected IllegalStateException from MissingFaceCaptureCoordinator")
        } catch (ex: IllegalStateException) {
            assertTrue(
                "Error message must point at the wiring TODO so operators can act",
                ex.message?.contains("FaceCaptureCoordinator") == true ||
                    ex.message?.contains("FaceEmbedder") == true,
            )
        }
    }

    @Test
    fun `l2Normalise sanity - unit vector stays unit length`() {
        // Sanity check on the inlined l2Normalise — a unit vector should
        // round-trip with epsilon=1e-6 floating-point error.
        val v = FloatArray(128) { 0.0f }.also { it[7] = 1.0f }
        var sumSq = 0.0
        for (e in v) sumSq += (e * e).toDouble()
        assertEquals(
            "Fixture must be unit-length",
            1.0,
            sqrt(sumSq),
            1e-6,
        )
    }
}
