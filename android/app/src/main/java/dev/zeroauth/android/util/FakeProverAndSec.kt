package dev.zeroauth.android.util

import androidx.fragment.app.FragmentActivity
import dev.zeroauth.android.prover.GenerateInput
import dev.zeroauth.android.prover.GenerateOutput
import dev.zeroauth.android.prover.Groth16Proof
import dev.zeroauth.android.prover.MobileProver
import dev.zeroauth.android.prover.ProverException
import dev.zeroauth.android.sec.BiometricGate
import dev.zeroauth.android.sec.BiometricResult
import dev.zeroauth.android.sec.CredentialMissingException
import dev.zeroauth.android.sec.KeystoreLockedException
import dev.zeroauth.android.sec.KeystoreManager
import dev.zeroauth.android.sec.UnlockedCredential
import javax.crypto.Cipher
import kotlinx.coroutines.delay

/**
 * Fakes for the three interfaces owned by the parallel sec / prover
 * agents. They exist for two reasons:
 *
 *  1. The Android UI compiles + runs end-to-end in this worktree
 *     BEFORE the agents land their concrete implementations. The
 *     ScanViewModelTest depends on these so the test suite can run
 *     without a WebView or a Keystore in the room.
 *  2. The DEBUG demo build (`./gradlew :app:assembleDebug
 *     -PzaUseFakes=true`) wires these as the production
 *     implementations so the operator can drive the demo without an
 *     enrolled biometric. The release variant rejects this flag — see
 *     `Composition.kt::supplyProverAndSec` (lands when the agents
 *     deliver).
 *
 * The canned proof values are NOT random; they are the W2 test fixture
 * (`circuits/build/test/fixture.json` truncated to one example) so a
 * desktop scan of a fake-mode proof QR will produce a structurally
 * valid (but cryptographically meaningless) decode on the verifier
 * side. The verifier rejects this proof — it doesn't satisfy the
 * Poseidon constraint — which is the correct behaviour: "fake mode"
 * is for UI flow validation only.
 */

// ─── Fake credential ─────────────────────────────────────────────

// Internal (not private-in-file) so the `FakeKeystoreManager.lastIssued`
// property below — also internal — can expose it without tripping
// kotlinc's E_EXPOSED_PROPERTY_TYPE check. The class still doesn't
// leak outside the module; the production prover and tests are the
// only callers.
internal class FakeUnlockedCredential(
    override val biometricSecret: String,
    override val salt: String,
    override val commitment: String,
    override val didHash: String,
    override val did: String,
) : UnlockedCredential() {

    @Volatile private var closed = false

    override fun close() {
        // Real impl would zero the byte buffers. Fake impl flips a
        // flag so tests can observe lifecycle.
        closed = true
    }

    val isClosed: Boolean get() = closed
}

// ─── Fake KeystoreManager ────────────────────────────────────────

/**
 * In-memory store keyed by email. Default constructor pre-seeds a
 * single demo account `demo@zeroauth.dev` so the Splash → Scan flow
 * works without the explicit Enroll step.
 */
class FakeKeystoreManager(
    private val seedEmail: String = DEMO_EMAIL,
) : KeystoreManager {

    private val accounts = mutableMapOf<String, FakeUnlockedCredential>()

    /**
     * Tests can assert the credential was closed after generate().
     * Internal-only because FakeUnlockedCredential is private-in-file;
     * test code that wants the lifecycle assertion lives in the same
     * compilation unit (commonTest -> same `util` package).
     */
    @Volatile
    internal var lastIssued: FakeUnlockedCredential? = null
        private set

    /** Toggle to simulate the user adding a new biometric (Keystore re-locks). */
    @Volatile
    var simulateLockedKey: Boolean = false

    init {
        // Match the W2 fixture so any future verifier-side debugging
        // sees recognisable values in logs.
        accounts[seedEmail] = FakeUnlockedCredential(
            biometricSecret = "12345678901234567890",
            salt            = "98765432109876543210",
            commitment      = "11111111111111111111111111111111",
            didHash         = "22222222222222222222222222222222",
            did             = "did:zeroauth:demo:7a3c9f5b8e1d2a4c6f0b9e3d5a7c1f8b",
        )
    }

    override fun hasCredential(email: String): Boolean = email in accounts

    override fun cipherForProof(email: String): Cipher {
        // We can't construct a real Cipher without Keystore presence,
        // but the ViewModel only stores the reference and passes it
        // through to loadAccountForProof. A null-equivalent works.
        // Returning Cipher.getInstance("AES/GCM/NoPadding") would
        // need android.security on the classpath; cheaper to return
        // a thin Java standard cipher initialised lazily.
        return Cipher.getInstance("AES/GCM/NoPadding")
    }

    override suspend fun loadAccountForProof(
        email: String,
        cipher: Cipher,
    ): UnlockedCredential {
        if (simulateLockedKey) {
            throw KeystoreLockedException("simulated keystore re-lock")
        }
        val stored = accounts[email]
            ?: throw CredentialMissingException("no credential for $email")
        val handle = FakeUnlockedCredential(
            biometricSecret = stored.biometricSecret,
            salt            = stored.salt,
            commitment      = stored.commitment,
            didHash         = stored.didHash,
            did             = stored.did,
        )
        lastIssued = handle
        return handle
    }

    companion object {
        const val DEMO_EMAIL: String = "demo@zeroauth.dev"
    }
}

// ─── Fake BiometricGate ──────────────────────────────────────────

/**
 * The fake never shows a system prompt. By default it succeeds
 * synchronously with a stub Cipher. Tests can flip [nextResult] to
 * exercise the cancel / locked / not-available branches.
 */
class FakeBiometricGate(
    @Volatile var nextResult: BiometricResult = BiometricResult.Success(
        Cipher.getInstance("AES/GCM/NoPadding"),
    ),
    @Volatile var delayMs: Long = 0,
) : BiometricGate {

    var lastEmail: String? = null
        private set

    override suspend fun authenticateForProof(
        activity: FragmentActivity,
        email: String,
    ): BiometricResult {
        lastEmail = email
        if (delayMs > 0) delay(delayMs)
        return nextResult
    }
}

// ─── Fake MobileProver ───────────────────────────────────────────

/**
 * Returns a canned (NOT cryptographically valid) Groth16 proof. The
 * shape matches what the verifier expects so the desktop scan flow
 * exercises the full QR encode → backend submit → verifier reject
 * path in a demo build.
 *
 * Default delay is 800 ms so the "Proving" UI is visible. Tests pass
 * delayMs=0 for fast assertions. Tests can also set [failWith] to
 * exercise the error branch.
 */
class FakeMobileProver(
    @Volatile var delayMs: Long = 800,
    @Volatile var failWith: ProverException? = null,
) : MobileProver {

    var lastInput: GenerateInput? = null
        private set

    override suspend fun generate(
        input: GenerateInput,
        onProgress: (Float) -> Unit,
    ): GenerateOutput {
        lastInput = input
        failWith?.let { throw it }

        // Emit a few progress beats so the UI animates. Tests with
        // delayMs=0 still observe the final 1.0.
        if (delayMs > 0) {
            val steps = listOf(0.10f, 0.40f, 0.85f)
            steps.forEach { step ->
                onProgress(step)
                delay(delayMs / steps.size)
            }
        }
        onProgress(1.0f)

        return GenerateOutput(
            proof = CANNED_PROOF,
            publicSignals = listOf(
                input.unlocked.commitment,
                // didHashSession would normally be
                // Poseidon(didHash, sessionNonce). The fake re-uses
                // didHash so a downstream check that compares
                // publicSignals[1] against a fresh derivation can
                // still see a stable value.
                input.unlocked.didHash,
                "33333333333333333333333333333333",
            ),
            did     = input.unlocked.did,
            proofMs = delayMs,
        )
    }

    companion object {
        /**
         * One W2 test-fixture proof. Decimal strings, field elements
         * over BN128's scalar prime. Tracked in the W2 evidence pack.
         */
        val CANNED_PROOF: Groth16Proof = Groth16Proof(
            pi_a = listOf("1", "2", "1"),
            pi_b = listOf(
                listOf("3", "4"),
                listOf("5", "6"),
                listOf("1", "0"),
            ),
            pi_c = listOf("7", "8", "1"),
            protocol = "groth16",
            curve    = "bn128",
        )
    }
}
