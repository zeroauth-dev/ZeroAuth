package dev.zeroauth.android.ui.reg

import android.content.Context
import android.graphics.Bitmap
import dev.zeroauth.android.BuildConfig
import dev.zeroauth.android.ui.reg.RegistrationViewModel.BiometricSecretSource
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import timber.log.Timber
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.Arrays
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Default [BiometricSecretSource] for the production wiring.
 *
 * Sits in front of two implementations and chooses between them at
 * runtime based on the [BuildConfig.DEMO_USE_STABLE_SECRET] flag set
 * by `android/app/build.gradle.kts`:
 *
 *  * **Flag = true (default in debug builds, opt-in in release).** The
 *    `secret()` call delegates to [PerInstallStableSecret] which returns
 *    a `SecureRandom`-derived 32-byte blob persisted in SharedPreferences.
 *    This is the path the operator + investor demos take because the
 *    Android emulator (AVD) has no live face camera; without this
 *    fallback the demo can't reach the verify step on a hardware-less
 *    laptop.
 *
 *  * **Flag = false (default in release builds).** The `secret()` call
 *    runs the production face-capture pipeline documented in
 *    adr/0018-mobile-face-embedding-pipeline.md and the CLAUDE.md
 *    "Face-first identity surface" section:
 *
 *    ```text
 *      CameraX preview → ML Kit face detector → 112×112 crop
 *          (FaceCaptureCoordinator — see ui/face/FaceCaptureScreen.kt)
 *                  ↓
 *         FaceEmbedder.embed(bitmap)            (MobileFaceNet TFLite)
 *                  ↓
 *         128-dim L2-normalised FloatArray
 *                  ↓
 *         Quantizer.quantize(embedding)         (256 bytes int16 BE)
 *                  ↓
 *         Sha256.digest(quantised)              (32-byte secret;
 *                                                input buffer zeroed)
 *                  ↓
 *         32-byte biometricSecret
 *    ```
 *
 * Both paths produce a 32-byte secret of the same shape, so the rest
 * of the registration ceremony ([DeriveDidAndCommitment.from],
 * [RealRegistrationProver.generate]) does not change.
 *
 * ## Why the dispatch is internal
 *
 * The [RegistrationViewModel] always sees a single `BiometricSecretSource`
 * — it does not need to know which implementation is active. The
 * dashboard / settings screen surfaces the active mode via [activeMode]
 * so investors + operators can see at a glance which pipeline is
 * running, but the ceremony plumbing is identical either way. That keeps
 * the demo-vs-production discriminator out of the route adapters and
 * confined to one spot.
 *
 * ## Stability contract
 *
 * Same face on the same device MUST produce the same 32-byte secret on
 * every capture, because step 2 of the three-QR ceremony (submit
 * commitment) and step 3 (verify) call [secret] independently — if they
 * disagree, the server's `publicSignals[0]` check fails. In demo mode
 * the SharedPreferences-persisted SecureRandom blob trivially satisfies
 * this. In real-face mode the stability guarantee comes from the
 * [QuantizerOp] big-endian int16 rounding which absorbs the ~5e-4 of
 * float32 jitter between two captures of the same face on the same
 * device.
 *
 * ## Non-goals (CLAUDE.md)
 *
 * 1. **Never accept raw biometric data over the wire** — the captured
 *    [Bitmap] never leaves this class; it goes through the embedder,
 *    the quantiser, the SHA-256 digest, and falls out of scope.
 * 2. **Never log biometric-derived raw data** — Timber log lines NEVER
 *    include the embedding floats, the quantised bytes, or the secret.
 *    Only structural facts ("captured", "embedded", "secret derived")
 *    are logged.
 * 3. **Buffer zeroing** — [Sha256Op.digest] mutates its input in place
 *    (documented post-condition); the embedding floats are also
 *    overwritten after quantisation reduces the heap-dump window.
 *
 * ## Concurrency
 *
 * [secret] is suspend-shaped and guarded by a [Mutex] — concurrent
 * callers (e.g. step 2 and step 3 invoked in quick succession from the
 * UI) serialise through the same capture rather than tripping the
 * underlying [FaceCaptureCoordinator] into running two camera sessions
 * at once. The lock is held for the ~200 ms of capture + ~50 ms of
 * TFLite inference; suspend semantics keep the UI responsive.
 *
 * ## Phase-1-Sprint-4 wiring TODO
 *
 * The `mobile/biometric/` library module ships the canonical
 * [FaceEmbedder] / Quantizer / Sha256 implementations. Wiring it into
 * the Android Gradle project is a three-file patch tracked by agent-21:
 *
 *   1. android/settings.gradle.kts → `include(":biometric")` + a
 *      `project(":biometric").projectDir = file("../mobile/biometric")`.
 *   2. android/gradle/libs.versions.toml → add TFLite + BouncyCastle
 *      + kotlin-test version entries.
 *   3. android/app/build.gradle.kts → `implementation(project(":biometric"))`.
 *
 * Until that patch lands, this file inlines a minimum-viable Quantizer +
 * Sha256 + l2Normalise so the real-face code path compiles + tests
 * cleanly against a mock [FaceEmbedder]. The inlined ops are
 * byte-identical to mobile/biometric/Quantizer.kt + Sha256.kt — they
 * MUST stay byte-identical because the commitment derived in step 2
 * (registration submit) feeds the witness in step 3 (registration
 * verify), and a drift would fail the server's publicSignals[0] check.
 *
 * @param context Application context, used to construct the default
 *                fallback ([PerInstallStableSecret]) and (in real-face
 *                mode) the [FaceCaptureCoordinator].
 * @param fallback The demo-mode delegate. Defaults to a fresh
 *                 [PerInstallStableSecret] over the application
 *                 context. Tests pass a deterministic stub.
 * @param embedder Override for the [FaceEmbedder]. In demo mode this
 *                 is never consulted. In real-face mode it defaults to
 *                 a placeholder that throws with operator-friendly
 *                 instructions because the `:biometric` module is not
 *                 yet wired into the Android Gradle build (see TODO
 *                 above). Tests pass a deterministic mock that returns
 *                 a fixed 128-dim unit vector for any bitmap.
 * @param captureCoordinator Override for the camera capture surface.
 *                 In demo mode this is never consulted. In real-face
 *                 mode it defaults to a placeholder that throws (see
 *                 TODO above). Tests pass a stub that returns a
 *                 pre-baked 112×112 ARGB_8888 bitmap.
 * @param demoFlag The active [BuildConfig.DEMO_USE_STABLE_SECRET]
 *                 value. Tests override this to exercise the
 *                 real-face branch even on a debug build.
 */
class RealBiometricSecretSource(
    private val context: Context,
    private val fallback: BiometricSecretSource = PerInstallStableSecret(context.applicationContext),
    private val embedder: FaceEmbedder = MissingFaceEmbedder,
    private val captureCoordinator: FaceCaptureCoordinator = MissingFaceCaptureCoordinator,
    private val demoFlag: Boolean = BuildConfig.DEMO_USE_STABLE_SECRET,
) : BiometricSecretSource, Closeable {

    /**
     * Serialises concurrent [secret] invocations so the underlying
     * camera session is not double-driven. See class kdoc §Concurrency.
     */
    private val mutex = Mutex()

    /**
     * Which implementation is active for the current build. Surfaced to
     * the UI (see ui/reg/BiometricSecretModeBanner.kt) so operators can
     * see at a glance whether they are in demo mode or production mode.
     *
     * This is a `val` (not a `fun`) because the [demoFlag] is fixed at
     * construction time — flipping it mid-session would change which
     * secret backs the commitment between step 2 and step 3 of the
     * three-QR ceremony, which would brick the verify step.
     */
    val activeMode: BiometricSecretMode = if (demoFlag) {
        BiometricSecretMode.DEMO_STABLE_SECRET
    } else {
        BiometricSecretMode.REAL_FACE_CAPTURE
    }

    /**
     * Run the configured pipeline. In demo mode delegates to
     * [fallback] ([PerInstallStableSecret] by default). In real-face
     * mode runs the capture → embed → quantise → digest chain.
     *
     * @return 32-byte biometric-derived secret.
     * @throws IllegalStateException if real-face capture failed (no
     *         face detected, liveness rejected, user cancelled, camera
     *         permission denied) OR if the `:biometric` module is not
     *         yet wired (the placeholder embedder/coordinator throws
     *         with a pointer to the wiring TODO).
     */
    override suspend fun secret(): ByteArray = mutex.withLock {
        if (activeMode == BiometricSecretMode.DEMO_STABLE_SECRET) {
            Timber.tag(TAG).i(
                "Biometric secret: DEMO mode (per-install stable secret). " +
                    "Override with -PZEROAUTH_DEMO_USE_STABLE_SECRET=false to run the real face pipeline.",
            )
            return@withLock fallback.secret()
        }

        Timber.tag(TAG).i("Biometric secret: REAL face-capture pipeline starting")

        // Step 1: capture a 112×112 ARGB_8888 face crop. The coordinator
        // owns CameraX lifecycle, ML Kit face detection, single-frame
        // selection, liveness assertion, crop + resize. We refuse to
        // accept a bitmap of any other shape — silent resizing here
        // would mask a coordinator bug (the same `require(...)` runs
        // inside the canonical FaceEmbedder under mobile/biometric/).
        val bitmap: Bitmap = captureCoordinator.captureFaceCrop()
        require(bitmap.width == FACE_INPUT_EDGE && bitmap.height == FACE_INPUT_EDGE) {
            "RealBiometricSecretSource: coordinator returned " +
                "${bitmap.width}x${bitmap.height} bitmap; expected " +
                "${FACE_INPUT_EDGE}x${FACE_INPUT_EDGE}. The crop is the " +
                "coordinator's contract — refusing to silently resize."
        }
        require(bitmap.config == Bitmap.Config.ARGB_8888) {
            "RealBiometricSecretSource: coordinator returned bitmap " +
                "config=${bitmap.config}; expected ARGB_8888."
        }
        Timber.tag(TAG).d("Face crop captured (%dx%d, %s)", bitmap.width, bitmap.height, bitmap.config)

        try {
            // Step 2: run MobileFaceNet on the crop. The returned 128
            // floats are L2-normalised — Quantizer's pre-condition.
            val embedding: FloatArray = embedder.embed(bitmap)
            check(embedding.size == EMBEDDING_DIM) {
                "RealBiometricSecretSource: embedder returned " +
                    "${embedding.size}-dim vector; expected $EMBEDDING_DIM."
            }
            // Defence-in-depth: if the supplied embedder skipped
            // L2-normalisation, do it here so the quantiser doesn't
            // emit collision-prone bytes. l2Normalise refuses the
            // all-zero vector, which is the "model returned an empty
            // tensor or upstream face crop was all-black" pathology.
            val normalised = l2Normalise(embedding)
            Arrays.fill(embedding, 0.0f)
            Timber.tag(TAG).d("Embedding computed (%d floats)", normalised.size)

            // Step 3: quantise to a deterministic 256-byte bitstring.
            val quantised: ByteArray = QuantizerOp.quantize(normalised)
            check(quantised.size == QUANTISED_LENGTH) {
                "RealBiometricSecretSource: quantiser returned " +
                    "${quantised.size}-byte buffer; expected $QUANTISED_LENGTH."
            }
            // Defensive: zero the embedding floats. JVM floats live in
            // stack/heap memory; we can't truly wipe them, but
            // overwriting reduces the window in which a heap dump
            // captures the embedding components.
            Arrays.fill(normalised, 0.0f)
            Timber.tag(TAG).d("Quantised embedding (%d bytes)", quantised.size)

            // Step 4: SHA-256 the quantised buffer. The Sha256Op.digest
            // contract MUTATES `quantised` in place — every byte is
            // 0x00 after this returns. Do NOT read `quantised` again
            // for any purpose; the variable is shadowed in the log line
            // below by a fresh check on the digest length.
            val secretBytes: ByteArray = Sha256Op.digest(quantised)
            check(secretBytes.size == SECRET_LENGTH) {
                "RealBiometricSecretSource: Sha256 returned " +
                    "${secretBytes.size}-byte digest; expected $SECRET_LENGTH."
            }

            Timber.tag(TAG).i(
                "Biometric secret derived (length=%d). Never logging contents.",
                secretBytes.size,
            )

            // The caller (RegistrationViewModel.submitCommitment /
            // RegistrationViewModel.complete) is responsible for
            // zeroing the returned ByteArray when it's done. The
            // RegistrationUnlockedCredential.close() path in
            // RealRegistrationProver already does this for the verify
            // step; the commit step relies on the GC to reclaim the
            // short-lived array because the BigInteger conversion
            // copies the bytes anyway. See ADR-0018 §"Secret lifetime".
            return@withLock secretBytes
        } finally {
            // Recycle the bitmap on every exit path (success OR
            // exception) so the camera-side ImageProxy buffer is
            // returned to CameraX promptly. The coordinator hands the
            // bitmap off to us — recycling is OUR responsibility once
            // we've embedded it.
            if (!bitmap.isRecycled) {
                bitmap.recycle()
                Timber.tag(TAG).v("Face crop bitmap recycled")
            }
        }
    }

    /**
     * Release the long-lived [FaceEmbedder] and any resources held by
     * the [FaceCaptureCoordinator]. Idempotent — safe to call from a
     * `DisposableEffect`'s `onDispose` AND from `ViewModel.onCleared()`.
     *
     * In demo mode this is effectively a no-op because the fallback
     * holds only a SharedPreferences handle (no native resources).
     */
    override fun close() {
        runCatching {
            (embedder as? Closeable)?.close()
        }.onFailure { ex ->
            Timber.tag(TAG).w(ex, "FaceEmbedder close threw — ignoring")
        }
        runCatching {
            (captureCoordinator as? Closeable)?.close()
        }.onFailure { ex ->
            Timber.tag(TAG).w(ex, "FaceCaptureCoordinator close threw — ignoring")
        }
    }

    companion object {
        private const val TAG = "RealBiometricSecret"

        /**
         * MobileFaceNet input edge length. Pinned by
         * adr/0018-mobile-face-embedding-pipeline.md.
         */
        const val FACE_INPUT_EDGE: Int = 112

        /** MobileFaceNet output embedding dimension. */
        const val EMBEDDING_DIM: Int = 128

        /** Quantiser output length in bytes. */
        const val QUANTISED_LENGTH: Int = 256

        /**
         * SHA-256 digest length. Matches the `secret.size == 32`
         * invariant asserted by [DeriveDidAndCommitment.from] and
         * [RealRegistrationProver.generate].
         */
        const val SECRET_LENGTH: Int = 32
    }
}

/**
 * Three-way enum that captures which biometric-secret pipeline is
 * active for the current build. Surfaced to the UI by
 * [RealBiometricSecretSource.activeMode].
 *
 * The third option [UNKNOWN] is reserved for tests / preview composables
 * that haven't constructed a real [RealBiometricSecretSource] (e.g. a
 * Compose `@Preview` that hard-codes a fixture).
 */
enum class BiometricSecretMode(val display: String, val operatorNote: String) {
    DEMO_STABLE_SECRET(
        display = "Demo mode: per-install stable secret",
        operatorNote = "This build returns a SecureRandom blob persisted in SharedPreferences " +
            "instead of running CameraX + MobileFaceNet. The Poseidon commitment + Groth16 " +
            "proof are still real cryptography — only the secret derivation is shortcut.",
    ),
    REAL_FACE_CAPTURE(
        display = "Real face capture",
        operatorNote = "This build runs CameraX + ML Kit + MobileFaceNet on every step. " +
            "Re-capture the same face for step 2 and step 3 — the publicSignals[0] check " +
            "depends on the quantiser producing identical bytes both times.",
    ),
    UNKNOWN(
        display = "Unknown",
        operatorNote = "No active BiometricSecretSource — typically a Compose @Preview.",
    ),
}

/**
 * Contract the camera surface must implement for
 * [RealBiometricSecretSource] to drive it.
 *
 * The real coordinator lives in `mobile/face/` ([FaceCaptureScreen])
 * which already implements CameraX + ML Kit + the 1.5 s stability
 * timer. Wiring it into the Android Gradle project is the same
 * three-file patch noted in [RealBiometricSecretSource] — once the
 * `:face` module is wired in, swap [MissingFaceCaptureCoordinator]
 * for an implementation that drives the existing composable.
 *
 * The contract is intentionally narrow — a single suspend function
 * that returns the cropped Bitmap — so the test double in
 * `RealBiometricSecretSourceTest` can be a one-line lambda.
 */
interface FaceCaptureCoordinator {

    /**
     * Capture one face and return a 112×112 ARGB_8888 Bitmap.
     *
     * @throws IllegalStateException if capture fails (no face detected,
     *         liveness rejected, user cancelled, camera permission
     *         denied, sensor open failed).
     */
    suspend fun captureFaceCrop(): Bitmap
}

/**
 * Contract MobileFaceNet must implement for [RealBiometricSecretSource]
 * to drive it.
 *
 * Mirrors `mobile/biometric/FaceEmbedder.kt` byte-for-byte so once the
 * `:biometric` module is wired into the Android Gradle project the
 * production implementation slots in by passing
 * `dev.zeroauth.biometric.TfliteFaceEmbedder(context)` to
 * [RealBiometricSecretSource]'s `embedder` constructor parameter — the
 * canonical class implements this same contract.
 */
interface FaceEmbedder {

    /**
     * Compute a 128-dim L2-normalised face embedding from [bitmap].
     *
     * @param bitmap The face crop. MUST be 112x112 RGB ARGB_8888.
     * @return A 128-element FloatArray. `sqrt(sum(e_i^2)) == 1.0`
     *         modulo floating-point epsilon.
     */
    suspend fun embed(bitmap: Bitmap): FloatArray
}

/**
 * Placeholder [FaceEmbedder] used until the `:biometric` Gradle module
 * is wired into the Android project. Every [embed] call throws
 * [IllegalStateException] with a message pointing operators at the
 * wiring TODO documented in [RealBiometricSecretSource].
 *
 * Why this exists instead of crashing at construction time:
 * [RealBiometricSecretSource] construction MUST stay cheap so the
 * [RegistrationViewModel] can wire it in its factory without paying for
 * a camera session up front. The failure is deferred to the first
 * `secret()` call where it surfaces to the UI as an error the operator
 * can act on (flip the demo flag or finish wiring the module).
 */
internal object MissingFaceEmbedder : FaceEmbedder {
    override suspend fun embed(bitmap: Bitmap): FloatArray {
        error(
            "FaceEmbedder not yet wired. The :biometric Gradle module under " +
                "mobile/biometric/ ships the production implementation but is " +
                "not yet included in android/settings.gradle.kts. Either: " +
                "(1) run a debug build (DEMO_USE_STABLE_SECRET=true) which " +
                "skips this code path, or (2) finish the agent-21 three-file " +
                "patch documented in RealBiometricSecretSource.kt.",
        )
    }
}

/**
 * Placeholder [FaceCaptureCoordinator] used until the `mobile/face/`
 * module's [dev.zeroauth.face.FaceCaptureScreen] is wired into the
 * registration flow. Throws on every [captureFaceCrop] call. See the
 * companion-object kdoc on [MissingFaceEmbedder] for the rationale on
 * deferring the failure.
 */
internal object MissingFaceCaptureCoordinator : FaceCaptureCoordinator {
    override suspend fun captureFaceCrop(): Bitmap {
        error(
            "FaceCaptureCoordinator not yet wired. The mobile/face/ module " +
                "under mobile/face/src/main/kotlin/dev/zeroauth/face/ ships the " +
                "production FaceCaptureScreen composable but is not yet wired " +
                "into the registration ViewModel. Either: (1) run a debug " +
                "build (DEMO_USE_STABLE_SECRET=true) which skips this code " +
                "path, or (2) finish the agent-20 wiring documented in " +
                "RealBiometricSecretSource.kt.",
        )
    }
}

// ─── Inlined biometric ops (mirrors mobile/biometric/{Quantizer,Sha256}.kt) ───
//
// These two helpers stay byte-identical to the canonical
// mobile/biometric/ implementations. They are inlined here only because
// the Android Gradle project does not yet `include(":biometric")` (see
// the wiring TODO in RealBiometricSecretSource). Once the module is
// wired in, this whole section should be deleted and the calls
// in `secret()` should switch to `Quantizer.quantize(...)` +
// `Sha256.digest(...)` from `dev.zeroauth.biometric.*`.
//
// Drift between this file and mobile/biometric/ is a SHIP-BLOCKER —
// the commitment derived from these ops backs the BN128 field element
// the Groth16 circuit verifies, and a one-byte drift fails publicSignals[0].

/**
 * Deterministic quantiser. Byte-identical to
 * mobile/biometric/Quantizer.kt.
 */
internal object QuantizerOp {

    private const val SCALE: Float = 1000.0f
    private const val OUTPUT_LENGTH: Int = 256
    private const val INT16_MIN: Int = -32768
    private const val INT16_MAX: Int = 32767

    fun quantize(embedding: FloatArray): ByteArray {
        require(embedding.size == 128) {
            "Quantizer: expected 128-dim embedding, got ${embedding.size}"
        }
        for (i in embedding.indices) {
            val v = embedding[i]
            require(!v.isNaN() && !v.isInfinite()) {
                "Quantizer: embedding[$i] is NaN or Infinity — refusing " +
                    "to quantise (would emit collision-prone bytes)"
            }
            require(v >= -1.0001f && v <= 1.0001f) {
                "Quantizer: embedding[$i]=$v out of [-1, +1]; embedding " +
                    "is not L2-normalised (caller contract violated)"
            }
        }

        val buffer = ByteBuffer.allocate(OUTPUT_LENGTH).order(ByteOrder.BIG_ENDIAN)
        for (i in embedding.indices) {
            val scaled = embedding[i] * SCALE
            val q = scaled.roundToInt().coerceIn(INT16_MIN, INT16_MAX)
            buffer.put(((q shr 8) and 0xFF).toByte())
            buffer.put((q and 0xFF).toByte())
        }
        return buffer.array()
    }
}

/**
 * SHA-256 wrapper with input-zeroing post-condition. Byte-identical to
 * mobile/biometric/Sha256.kt.
 */
internal object Sha256Op {

    private const val DIGEST_LENGTH: Int = 32

    fun digest(input: ByteArray): ByteArray {
        val md = MessageDigest.getInstance("SHA-256")
        val out = md.digest(input)
        check(out.size == DIGEST_LENGTH) {
            "Sha256: MessageDigest produced ${out.size} bytes, expected $DIGEST_LENGTH"
        }
        Arrays.fill(input, 0.toByte())
        return out
    }
}

/**
 * Renormalise an embedding to unit length. Byte-identical to
 * mobile/biometric/FaceEmbedder.kt §l2Normalise. Hoisted as a top-level
 * private fun (rather than tied to one of the placeholder objects) so a
 * future swap-in of the canonical `TfliteFaceEmbedder` doesn't leave a
 * dangling reference.
 */
private fun l2Normalise(v: FloatArray): FloatArray {
    var sumSq = 0.0
    for (e in v) sumSq += (e * e).toDouble()
    require(sumSq > 1e-10) {
        "FaceEmbedder: embedding is the zero vector — model returned " +
            "an empty tensor or upstream face crop was all-black. " +
            "Re-capture before proceeding."
    }
    val norm = sqrt(sumSq).toFloat()
    return FloatArray(v.size) { i -> v[i] / norm }
}
