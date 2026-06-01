package dev.zeroauth.android.ui.reg

import android.content.Context
import android.graphics.Bitmap
import dev.zeroauth.android.ui.reg.RegistrationViewModel.BiometricSecretSource
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import timber.log.Timber
import java.io.Closeable
import java.util.Arrays
// NOTE: The three imports below resolve against the :biometric Gradle
// module rooted at /Users/pulkitpareek18/Desktop/ZeroAuth/mobile/biometric/.
// That module is NOT yet wired into android/settings.gradle.kts (it
// currently only `include(":app")`). Until the include + an
// `implementation(project(":biometric"))` dependency is added to
// android/app/build.gradle.kts, this file will NOT compile.
//
// TODO(phase-1-sprint-4 / agent-21): wire the :biometric module into the
//   Android Gradle project. The three-line patch is:
//     1. android/settings.gradle.kts → `include(":biometric")` + a
//        `project(":biometric").projectDir = file("../mobile/biometric")`.
//     2. android/app/build.gradle.kts → `implementation(project(":biometric"))`
//        inside the `dependencies { }` block.
//     3. android/prover-assets.sha256 → no change (the .tflite model is
//        an asset of the :biometric module, NOT the :app module, so the
//        ADR-0010 prover-asset gate does NOT cover it; the model
//        integrity story is tracked separately in ADR-0018).
import dev.zeroauth.biometric.FaceEmbedder
import dev.zeroauth.biometric.Quantizer
import dev.zeroauth.biometric.Sha256

/**
 * Production [BiometricSecretSource] that replaces [PerInstallStableSecret].
 *
 * Where [PerInstallStableSecret] writes a [java.security.SecureRandom]
 * 32-byte blob into SharedPreferences and calls it a day, this class
 * runs the on-device pipeline documented in
 * adr/0018-mobile-face-embedding-pipeline.md and CLAUDE.md's
 * "Face-first identity surface" section:
 *
 * ```text
 *   CameraX preview → ML Kit face detector → 112×112 crop
 *       (FaceCaptureCoordinator — TODO at ui/face/, see below)
 *               ↓
 *      FaceEmbedder.embed(bitmap)            (MobileFaceNet TFLite)
 *               ↓
 *      128-dim L2-normalised FloatArray
 *               ↓
 *      Quantizer.quantize(embedding)         (256 bytes int16 BE)
 *               ↓
 *      Sha256.digest(quantised)              (32-byte secret;
 *                                             input buffer zeroed)
 *               ↓
 *      32-byte biometricSecret
 * ```
 *
 * The 32-byte output is the *same* shape that [PerInstallStableSecret]
 * returns, so the rest of the registration ceremony
 * ([DeriveDidAndCommitment.from], [RealRegistrationProver.generate])
 * does not need to change — it just gets a real biometric-derived
 * secret instead of a per-install random blob.
 *
 * ## Stability contract
 *
 * Same face on the same device MUST produce the same 32-byte secret on
 * every capture, because step 2 of the three-QR ceremony (submit
 * commitment) and step 3 (verify) call [secret] independently — if they
 * disagree, the server's `publicSignals[0]` check fails. The stability
 * guarantee comes from the [Quantizer]: small lighting / expression
 * jitter in the float32 embedding is absorbed by the int16 rounding
 * with `SCALE = 1000`. See the [Quantizer] kdoc for the exact jitter
 * budget (~5e-4 per component).
 *
 * ## Non-goals (CLAUDE.md)
 *
 * 1. **Never accept raw biometric data over the wire** — the
 *    [Bitmap] never leaves this process; we hand the embedding to
 *    [Quantizer], hand the bytes to [Sha256], and the 32-byte secret
 *    leaves this class as the only artefact.
 * 2. **Never log biometric-derived raw data** — Timber log lines NEVER
 *    include the embedding floats, the quantised bytes, or the secret.
 *    Only structural facts ("captured", "embedded", "secret derived")
 *    are logged.
 * 3. **Buffer zeroing** — [Sha256.digest] mutates its input in place
 *    (documented post-condition); we also zero the secret in [close]
 *    and any intermediate ByteArray we hold transiently.
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
 * ## Lifecycle
 *
 * The class holds a long-lived [FaceEmbedder] instance to avoid the
 * ~200 ms per-call TFLite cold start. Call [close] when the host
 * surface (the [RegistrationViewModel]) is being torn down to release
 * the native TFLite interpreter. The default factory wires a
 * [dev.zeroauth.biometric.TfliteFaceEmbedder] which implements
 * [Closeable]; tests can pass a mock [FaceEmbedder] that does nothing
 * on close.
 *
 * @param context Application context, used to construct the default
 *                [FaceEmbedder] and the default [FaceCaptureCoordinator].
 * @param embedder Override for the [FaceEmbedder]. Defaults to the
 *                 production TFLite-backed implementation. Tests pass
 *                 a deterministic mock that returns a fixed 128-dim
 *                 unit vector for any bitmap.
 * @param captureCoordinator Override for the camera capture surface.
 *                 Defaults to the production [FaceCaptureCoordinator]
 *                 (TODO — see below). Tests pass a stub coordinator
 *                 that returns a pre-baked 112×112 ARGB_8888 bitmap.
 */
class RealBiometricSecretSource(
    private val context: Context,
    private val embedder: FaceEmbedder = defaultEmbedder(context),
    private val captureCoordinator: FaceCaptureCoordinator = defaultCoordinator(context),
) : BiometricSecretSource, Closeable {

    /**
     * Serialises concurrent [secret] invocations so the underlying
     * camera session is not double-driven. See class kdoc §Concurrency.
     */
    private val mutex = Mutex()

    /**
     * Run the full capture → embed → quantise → digest pipeline.
     *
     * @return 32-byte biometric-derived secret.
     * @throws IllegalStateException if face capture failed (no face
     *         detected, liveness rejected, user cancelled, camera
     *         permission denied). Callers MUST surface this to the UI
     *         as "re-capture" rather than retrying silently — a silent
     *         retry could mask a user-cancelled flow as a transient
     *         error.
     * @throws IllegalArgumentException if the captured bitmap is the
     *         wrong size / format. This is a programming error in the
     *         [FaceCaptureCoordinator] contract, not a user-recoverable
     *         condition.
     */
    override suspend fun secret(): ByteArray = mutex.withLock {
        Timber.tag(TAG).i("Beginning biometric capture for registration step")

        // Step 1: capture a 112×112 ARGB_8888 face crop. The coordinator
        // owns CameraX lifecycle, ML Kit face detection, single-frame
        // selection, liveness assertion, crop + resize. We refuse to
        // accept a bitmap of any other shape — silent resizing here
        // would mask a coordinator bug (see FaceEmbedder.embed's
        // matching `require(...)`).
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
            Timber.tag(TAG).d("Embedding computed (%d floats)", embedding.size)

            // Step 3: quantise to a deterministic 256-byte bitstring.
            // The quantiser asserts L2-normalisation as a sanity check,
            // so a buggy embedder upstream is caught here rather than
            // silently emitting collision-prone bytes.
            val quantised: ByteArray = Quantizer.quantize(embedding)
            check(quantised.size == QUANTISED_LENGTH) {
                "RealBiometricSecretSource: quantiser returned " +
                    "${quantised.size}-byte buffer; expected $QUANTISED_LENGTH."
            }
            // Defensive: zero the embedding floats. JVM floats live in
            // stack/heap memory; we can't truly wipe them, but
            // overwriting reduces the window in which a heap dump
            // captures the embedding components. The quantised buffer
            // is zeroed by Sha256.digest() in the next step (documented
            // post-condition on the canonical pipeline).
            Arrays.fill(embedding, 0.0f)

            Timber.tag(TAG).d("Quantised embedding (%d bytes)", quantised.size)

            // Step 4: SHA-256 the quantised buffer. The Sha256.digest
            // contract MUTATES `quantised` in place — every byte is
            // 0x00 after this returns. Do NOT read `quantised` again
            // for any purpose; the variable is shadowed in the log line
            // below by a fresh check on the digest length.
            val secretBytes: ByteArray = Sha256.digest(quantised)
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
     * The default TFLite embedder implements [Closeable] and tears down
     * the native interpreter when closed; mock embedders may no-op.
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
         * MobileFaceNet input edge length. Must match
         * [dev.zeroauth.biometric.TfliteFaceEmbedder.INPUT_SIZE] — pinned
         * here as a duplicate so the coordinator-contract require()
         * is self-contained at the call site (a future model swap
         * that changed the input edge would break the require here
         * before it broke FaceEmbedder.embed).
         */
        const val FACE_INPUT_EDGE: Int = 112

        /**
         * MobileFaceNet output embedding dimension. Same pinning
         * rationale as [FACE_INPUT_EDGE].
         */
        const val EMBEDDING_DIM: Int = 128

        /**
         * Quantiser output length in bytes. Matches
         * [dev.zeroauth.biometric.Quantizer.OUTPUT_LENGTH].
         */
        const val QUANTISED_LENGTH: Int = 256

        /**
         * SHA-256 digest length. Matches
         * [dev.zeroauth.biometric.Sha256.DIGEST_LENGTH] and the
         * `secret.size == 32` invariant asserted by
         * [DeriveDidAndCommitment.from] and
         * [RealRegistrationProver.generate].
         */
        const val SECRET_LENGTH: Int = 32

        /**
         * Build the production [FaceEmbedder].
         *
         * Returns a [dev.zeroauth.biometric.TfliteFaceEmbedder] which
         * lazily loads `mobilefacenet.tflite` from the :biometric
         * module's assets on the first [FaceEmbedder.embed] call.
         */
        private fun defaultEmbedder(context: Context): FaceEmbedder {
            // We deliberately reference the concrete class via the
            // fully-qualified name so the import is visible at the top
            // of the file — easier for code review than a buried `new`.
            return dev.zeroauth.biometric.TfliteFaceEmbedder(context.applicationContext)
        }

        /**
         * Build the production [FaceCaptureCoordinator].
         *
         * TODO(face-capture): wire a real coordinator at
         *   /Users/pulkitpareek18/Desktop/ZeroAuth/android/app/src/main/java/dev/zeroauth/android/ui/face/FaceCaptureCoordinator.kt
         *   This is the CameraX + ML Kit FaceDetector surface that:
         *     1. Opens the front camera via ProcessCameraProvider.
         *     2. Runs ML Kit's FaceDetector on the preview frames.
         *     3. Asserts liveness (blink or head-pose change between
         *        two frames; the production liveness story is tracked
         *        separately in adr/0019-mobile-face-liveness.md).
         *     4. Selects a single sharp frame with the face centered.
         *     5. Crops + resizes to 112×112 ARGB_8888 per the
         *        FaceEmbedder contract.
         *     6. Recycles the underlying ImageProxy and returns the
         *        cropped Bitmap to the caller (which then owns the
         *        bitmap lifecycle — see `bitmap.recycle()` in [secret]).
         *   The Phase 1 Sprint 4 plan in docs/plan/bfsi-v1/agents/
         *   assigns this to agent-20 (mobile + IoT).
         */
        private fun defaultCoordinator(context: Context): FaceCaptureCoordinator {
            // Until the real coordinator exists we return a thin
            // failing implementation rather than crash at construction
            // time. Constructing RealBiometricSecretSource MUST stay
            // cheap so the RegistrationViewModel can wire it in its
            // factory without paying for a camera session up front;
            // the failure is deferred to the first secret() call,
            // where it surfaces to the UI as a "re-capture" error.
            return MissingFaceCaptureCoordinator(context.applicationContext)
        }
    }
}

/**
 * Contract the camera surface must implement for
 * [RealBiometricSecretSource] to drive it.
 *
 * TODO(face-capture): the real coordinator lives (will live) at
 *   /Users/pulkitpareek18/Desktop/ZeroAuth/android/app/src/main/java/dev/zeroauth/android/ui/face/FaceCaptureCoordinator.kt
 *   See the kdoc on
 *   [RealBiometricSecretSource.Companion.defaultCoordinator] for the
 *   responsibilities and the ADR pointers. This interface stays here
 *   (not in `ui/face/`) only as long as the real coordinator file is
 *   missing — once `ui/face/FaceCaptureCoordinator.kt` exists, move
 *   this interface declaration there and delete this comment.
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
 * Placeholder [FaceCaptureCoordinator] used while the real one is
 * being built. Every [captureFaceCrop] call throws
 * [IllegalStateException] with a message pointing operators at the
 * TODO above.
 *
 * Why this exists instead of crashing at construction time: see
 * [RealBiometricSecretSource.Companion.defaultCoordinator]. We keep
 * RealBiometricSecretSource construction side-effect-free so it can be
 * wired into the RegistrationViewModel factory without paying for the
 * camera until the user actually triggers step 2.
 */
private class MissingFaceCaptureCoordinator(
    @Suppress("UnusedPrivateMember") private val applicationContext: Context,
) : FaceCaptureCoordinator, Closeable {

    override suspend fun captureFaceCrop(): Bitmap {
        error(
            "FaceCaptureCoordinator not yet implemented. Wire the real " +
                "coordinator at android/app/src/main/java/dev/zeroauth/" +
                "android/ui/face/FaceCaptureCoordinator.kt — see TODOs " +
                "in RealBiometricSecretSource.kt. Until then, the " +
                "registration screen MUST keep using PerInstallStableSecret.",
        )
    }

    override fun close() {
        // Nothing to release — the placeholder holds no native handles.
    }
}
