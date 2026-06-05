package dev.zeroauth.android.sec

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.util.Arrays

/**
 * Keystore-backed persistent store for the on-device face credential.
 *
 * Holds the two artefacts produced by the multi-step face enrollment
 * ceremony ([dev.zeroauth.android.ui.reg.RegistrationFaceCapture]):
 *
 *   1. **secret** — the 32-byte SHA-256(Quantize(L2(MobileFaceNet(front
 *      capture)))) buffer. Derived ONCE at enrollment and persisted here
 *      so subsequent sign-ins produce a byte-identical secret → byte-
 *      identical DID + commitment → server-side `publicSignals[0]`
 *      equality holds across sessions. This is the cryptographic root of
 *      the on-device identity.
 *
 *   2. **template** — the 4 anchor embeddings captured during enrollment
 *      (front, left-yaw, right-yaw, blink). Each is a 192-dim L2-
 *      normalised FloatArray (MobileFaceNet output). Used at sign-in
 *      time to verify the same face is unlocking the secret:
 *      [dev.zeroauth.android.biometric.FaceMatcher] computes cosine
 *      similarity between a fresh capture and all 4 anchors; if the max
 *      exceeds the threshold the secret is released.
 *
 * ## Why Keystore (not plain SharedPreferences)
 *
 * The secret is the cryptographic key material for the user's
 * identity. The template embeddings reveal face-shape information that,
 * while heavily lossy, is more sensitive than e.g. a session cookie.
 * Both live in Android Keystore-wrapped EncryptedSharedPreferences:
 *
 *   * Master key is generated via [MasterKey.Builder] with the
 *     `AES256_GCM` keyscheme. On devices with StrongBox (Pixel 3+, most
 *     2020+ flagships) the master key sits in dedicated tamper-resistant
 *     hardware; on older devices it falls back to the TEE. The
 *     enrollment path requests StrongBox when available.
 *   * Per-entry encryption is `AES256_SIV` for keys, `AES256_GCM` for
 *     values. SIV gives deterministic key encryption (so the
 *     SharedPreferences map remains a Map, not a per-entry random
 *     handle) while values still get fresh nonces.
 *
 * The Keystore master key is bound to this device install. An app
 * uninstall + reinstall (or factory reset) deletes the master key and
 * the encrypted blob becomes unreadable — which is the intended
 * behaviour. Cross-device recovery is handled by the mnemonic path in
 * `docs/plan/bfsi-v1/todo-deferred.md` (D-1), not by this store.
 *
 * ## Why this exists (architectural rationale)
 *
 * Without this store, every sign-in re-derives the secret from a fresh
 * face capture. MobileFaceNet's within-class drift (~1e-2 per
 * component) exceeds the [dev.zeroauth.biometric.Quantizer] tolerance
 * (~5e-4) — same face on the same camera produces different bytes
 * across captures, which means different DIDs, which means the server
 * can't find the user. By deriving ONCE at enrollment and persisting,
 * we collapse the drift problem to a face-MATCH problem (does the fresh
 * capture look like one of the 4 anchor embeddings?), which is what
 * MobileFaceNet was actually trained for and which it does well.
 *
 * The ZK wire property is unchanged: server stores
 * `commitment(stored_secret, salt)` + DID, the secret stays on-device,
 * proofs verify byte-for-byte against the stored commitment.
 *
 * ## API contract
 *
 * Single-writer (enrollment) + multi-reader (every sign-in). Reads are
 * cheap (~5 ms on a Pixel 6 — Keystore decrypts on access).
 *
 * The 32-byte secret returned by [readSecret] is a defensive copy; the
 * caller can zero it after deriving the [UnlockedCredential]. Same for
 * the template embeddings returned by [readTemplate] — defensive copies
 * so a caller can mutate the FloatArray without disturbing the cache.
 *
 * Use [clear] when the user explicitly removes their identity from this
 * device. The Keystore-encrypted blob is removed; the master key is
 * left in place because other identities on the same device install
 * might still need it.
 *
 * @param context Application context. Used to access the encrypted
 *                SharedPreferences file. Application context required
 *                because the EncryptedSharedPreferences API holds onto
 *                it for the lifetime of the prefs instance.
 */
class FaceTemplateStore(context: Context) {

    private val appContext = context.applicationContext

    // EncryptedSharedPreferences master key. Lazily constructed because
    // the underlying KeyStore.load() call dispatches an I/O round-trip
    // to the TEE / StrongBox — we do not want to pay this at app
    // construction time, only on first read or write.
    private val prefs: SharedPreferences by lazy {
        val masterKey = MasterKey.Builder(appContext, MASTER_KEY_ALIAS)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            // StrongBox is best-effort: requestStrongBoxBacked(true)
            // gracefully falls back to the TEE on devices without
            // StrongBox. We do NOT throw if StrongBox is unavailable
            // because the demo runs on emulators and on older hardware
            // where StrongBox is simply not present.
            .setRequestStrongBoxBacked(true)
            .build()
        EncryptedSharedPreferences.create(
            appContext,
            PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /**
     * Persist the enrollment artefacts. Called by the registration
     * ceremony after all 4 captures (front, left, right, blink) succeed.
     *
     * Overwrites any previous enrollment on this device — that's
     * intentional. A user re-enrolling on the same device (e.g. their
     * face changed, glasses, new haircut, beard) should be able to do
     * so without uninstalling the app. The previous secret is wiped;
     * the new secret + template take over.
     *
     * The supplied [secret] is copied internally; the caller is free to
     * zero its own copy after this returns. The supplied [template] is
     * deep-copied (each FloatArray cloned) for the same reason.
     *
     * @throws IllegalArgumentException if [secret] is not 32 bytes or
     *         [template] is not exactly [ANCHOR_COUNT] entries of
     *         [EMBEDDING_DIM] floats each.
     */
    fun writeEnrollment(secret: ByteArray, template: List<FloatArray>) {
        require(secret.size == SECRET_BYTES) {
            "FaceTemplateStore.writeEnrollment: secret must be $SECRET_BYTES bytes, got ${secret.size}"
        }
        require(template.size == ANCHOR_COUNT) {
            "FaceTemplateStore.writeEnrollment: template must have exactly $ANCHOR_COUNT anchors " +
                "(front/left/right/blink); got ${template.size}"
        }
        template.forEachIndexed { i, vec ->
            require(vec.size == EMBEDDING_DIM) {
                "FaceTemplateStore.writeEnrollment: anchor[$i] must be $EMBEDDING_DIM floats, got ${vec.size}"
            }
        }

        val templateJson = JSONArray().also { arr ->
            template.forEach { vec ->
                val row = JSONArray()
                for (f in vec) row.put(f.toDouble())
                arr.put(row)
            }
        }

        // Single-shot edit — both fields land together or not at all.
        // SharedPreferences.commit() (not apply()) so we know the bytes
        // are durable before we hand control back to the caller; the
        // caller is about to navigate away from the enrollment screen
        // and we want a process death immediately after to not lose
        // the enrollment.
        @Suppress("ApplySharedPref")
        val ok = prefs.edit()
            .putString(KEY_SECRET_HEX, hexEncode(secret))
            .putString(KEY_TEMPLATE_JSON, templateJson.toString())
            .putLong(KEY_ENROLLED_AT_MS, System.currentTimeMillis())
            .commit()
        if (!ok) {
            // Failure here is rare (disk full, IPC failure with the
            // encryption service). We log and throw — the caller's
            // catch will surface the error to the user instead of
            // silently shipping a half-written enrollment.
            throw IllegalStateException(
                "FaceTemplateStore.writeEnrollment: commit() returned false; enrollment NOT persisted",
            )
        }

        Timber.tag(TAG).i(
            "enrollment persisted: secret=32B template=%d×%d enrolled_at_ms=%d",
            template.size,
            EMBEDDING_DIM,
            prefs.getLong(KEY_ENROLLED_AT_MS, -1L),
        )
    }

    /**
     * Read the persisted 32-byte secret. Returns null if no enrollment
     * has been written yet — the caller is responsible for routing the
     * user back to the enrollment flow in that case.
     *
     * The returned ByteArray is a freshly-allocated defensive copy. The
     * caller MUST `Arrays.fill(returned, 0)` after the secret is no
     * longer needed (typically after the proof witness has been built
     * and the [UnlockedCredential] is in flight). Failing to zero is
     * not a security bug per se — the Keystore-backed prefs are
     * encrypted at rest — but it widens the window during which a heap
     * dump could capture the bytes.
     */
    fun readSecret(): ByteArray? {
        val hex = prefs.getString(KEY_SECRET_HEX, null) ?: return null
        if (hex.length != SECRET_BYTES * 2) {
            Timber.tag(TAG).w(
                "readSecret: unexpected secret length %d (expected %d hex chars). " +
                    "Treating as no-enrollment. The stored value will be overwritten on next enrollment.",
                hex.length,
                SECRET_BYTES * 2,
            )
            return null
        }
        return hexDecode(hex)
    }

    /**
     * Read the persisted 4-anchor template. Returns null if no
     * enrollment has been written yet.
     *
     * Each anchor is a defensive copy of the persisted 192-float
     * embedding. Callers that pass these into the matcher are free to
     * mutate the FloatArrays without affecting subsequent reads.
     */
    fun readTemplate(): List<FloatArray>? {
        val json = prefs.getString(KEY_TEMPLATE_JSON, null) ?: return null
        return try {
            val arr = JSONArray(json)
            if (arr.length() != ANCHOR_COUNT) {
                Timber.tag(TAG).w(
                    "readTemplate: unexpected anchor count %d (expected %d). " +
                        "Treating as no-enrollment.",
                    arr.length(),
                    ANCHOR_COUNT,
                )
                return null
            }
            (0 until arr.length()).map { i ->
                val row = arr.getJSONArray(i)
                if (row.length() != EMBEDDING_DIM) {
                    throw IllegalStateException(
                        "anchor $i has ${row.length()} floats, expected $EMBEDDING_DIM",
                    )
                }
                FloatArray(EMBEDDING_DIM) { j -> row.getDouble(j).toFloat() }
            }
        } catch (t: Throwable) {
            Timber.tag(TAG).e(t, "readTemplate: JSON parse failed; treating as no-enrollment")
            null
        }
    }

    /**
     * Whether an enrollment has been written. Equivalent to
     * `readSecret() != null && readTemplate() != null` but cheaper —
     * just checks for key presence without decoding.
     */
    fun hasEnrollment(): Boolean =
        prefs.contains(KEY_SECRET_HEX) && prefs.contains(KEY_TEMPLATE_JSON)

    /**
     * Wipe the persisted enrollment. Use when the user explicitly
     * removes their identity from this device (Settings → "Remove
     * identity" CTA). The master key is left in place so a fresh
     * enrollment on the same install does not pay the Keystore key-
     * generation cost again.
     */
    fun clear() {
        @Suppress("ApplySharedPref")
        prefs.edit()
            .remove(KEY_SECRET_HEX)
            .remove(KEY_TEMPLATE_JSON)
            .remove(KEY_ENROLLED_AT_MS)
            .commit()
        Timber.tag(TAG).i("enrollment cleared")
    }

    /**
     * Zero a 32-byte secret in place. Convenience for callers that
     * read via [readSecret], consume the bytes, and want a one-liner
     * for cleanup.
     */
    fun zeroSecret(secret: ByteArray) {
        Arrays.fill(secret, 0.toByte())
    }

    companion object {
        private const val TAG = "FaceTemplateStore"

        /** Encrypted SharedPreferences file. Lives under the app's data dir. */
        private const val PREFS_FILE = "zeroauth_face_template"

        /** Keystore master key alias. Per-app — does not collide with other apps. */
        private const val MASTER_KEY_ALIAS = "zeroauth_face_template_master"

        /** Hex-encoded 32-byte secret. */
        private const val KEY_SECRET_HEX = "secret_hex"

        /** JSON-encoded `[[Float]]` template; ANCHOR_COUNT × EMBEDDING_DIM. */
        private const val KEY_TEMPLATE_JSON = "template_json"

        /** Wall-clock milliseconds of enrollment. Diagnostic only. */
        private const val KEY_ENROLLED_AT_MS = "enrolled_at_ms"

        /** Length of the persisted secret in bytes. SHA-256 → 32. */
        const val SECRET_BYTES: Int = 32

        /**
         * Number of anchor embeddings in the template. Matches the four
         * stages of the enrollment ceremony: front, left, right, blink.
         * If a future ceremony adds a fifth stage (e.g. mouth-open
         * liveness), bump this AND
         * [dev.zeroauth.android.ui.reg.RegistrationFaceCapture]'s
         * stage list in lockstep.
         */
        const val ANCHOR_COUNT: Int = 4

        /**
         * Per-anchor embedding dimension. Matches
         * [dev.zeroauth.biometric.TfliteFaceEmbedder.EMBEDDING_DIM] —
         * the MCarlomagno MobileFaceNet mirror outputs 192-dim
         * embeddings. If the model is ever swapped (e.g. to a 128-dim
         * upstream sirius-ai variant or 512-dim ArcFace), bump this
         * constant AND the model in lockstep.
         */
        const val EMBEDDING_DIM: Int = 192

        fun hexEncode(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }

        fun hexDecode(hex: String): ByteArray =
            ByteArray(hex.length / 2) { i ->
                ((Character.digit(hex[i * 2], 16) shl 4)
                    + Character.digit(hex[i * 2 + 1], 16)).toByte()
            }
    }
}
