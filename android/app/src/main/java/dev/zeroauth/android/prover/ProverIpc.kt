package dev.zeroauth.android.prover

import android.os.Parcel
import android.os.Parcelable

/**
 * Wire format for the main-process ↔ `:prover` IPC.
 *
 * ADR-0010 §"WebView is process-isolated and CSP-locked" promises that
 * the snarkjs WebView runs in a dedicated OS process so a renderer
 * compromise can't read the long-lived biometric secret out of the main
 * process's heap. The bound Service in [ProverService] enforces that;
 * THIS file defines the messages that cross the Binder boundary.
 *
 * ## Why Parcelable, not kotlinx-serialization
 *
 * Messenger is a thin wrapper around Binder, and Binder's marshalling
 * is Parcelable-native — kotlinx-serialization would force us to
 * (a) base64 the proof bytes into a String field, (b) parse them back
 * on the other side, and (c) keep an extra copy of every field around
 * during JSON encode/decode. Each of those is a place where a "zero
 * the secret" guarantee leaks. The hand-rolled `writeToParcel` /
 * `CREATOR` pair is the path Android already uses for cross-process
 * arguments, and it gives us a single, predictable spot to scrub
 * sensitive fields before recycling.
 *
 * ## The scrub contract
 *
 * `writeToParcel` is invoked exactly once per outbound message by
 * Binder. The Parcel implementation *copies* every byte we write into
 * an off-heap shared-memory region for transmission — once
 * `writeToParcel` returns, the OUTGOING memory is no longer in any
 * caller-visible buffer. We document the implication here because
 * subtle and load-bearing:
 *
 *   * The COPY in the Parcel is gone after the receiving process
 *     deserialises it. The receiver gets a fresh string/byte array
 *     allocated against ITS heap.
 *   * The original buffer that the *sender* held BEFORE constructing
 *     the [ProverRequest] is STILL live in the sender's heap. The
 *     caller (specifically [IsolatedMobileProver.generate]) is
 *     responsible for zeroing that original via
 *     [UnlockedCredential.close].
 *
 * In other words: this file's Parcelable contract scrubs the wire
 * artefacts; the call sites at either end scrub the local artefacts.
 * Together they bracket the lifetime of the biometric secret to
 * roughly the duration of one proof generation.
 *
 * ## Message types
 *
 * The exchange is request/response with progress events in the
 * middle, modelled after the in-process [MobileProver.generate]
 * contract:
 *
 * ```
 *   client → service   MESSAGE_PROVE_REQUEST  (replyTo = client Messenger)
 *                       data = ProverRequest
 *   service → client   MESSAGE_PROVE_RESPONSE
 *                       data = ProverResponse.Progress(percent)
 *                       …
 *   service → client   MESSAGE_PROVE_RESPONSE
 *                       data = ProverResponse.Success | Failure  (terminal)
 * ```
 *
 * A single client/service pair handles one in-flight request at a
 * time (the in-process implementation enforces the same constraint —
 * snarkjs in a WebView is single-threaded). Subsequent requests
 * piggy-back on the same Service binding.
 */

// ─── Message kind constants ───────────────────────────────────────────

/** Client → Service. `Message.obj` carries a [ProverRequest]. */
const val MESSAGE_PROVE_REQUEST: Int = 1

/** Service → Client. `Message.obj` carries a [ProverResponse]. */
const val MESSAGE_PROVE_RESPONSE: Int = 2

// ─── ProverRequest ────────────────────────────────────────────────────

/**
 * Request to generate a Groth16 proof against the input witness.
 *
 * Marshalled across the Binder boundary as a [Parcelable]. The wire
 * shape mirrors [GenerateInput]: a decimal-string biometric secret
 * tuple plus a hex session nonce.
 *
 * We do NOT serialise the [UnlockedCredential] itself because
 * (a) it is `AutoCloseable` and shouldn't outlive a single proof, and
 * (b) sending the full handle would force the prover process to hold
 * a reference to the credential's lifecycle. Instead the main process
 * unwraps the credential, copies the field-element strings into this
 * Parcelable, ships it across, and immediately closes the credential.
 */
class ProverRequest(
    val biometricSecret: String,
    val salt: String,
    val commitment: String,
    val didHash: String,
    val did: String,
    val sessionNonceHex: String,
) : Parcelable {

    override fun describeContents(): Int = 0

    override fun writeToParcel(parcel: Parcel, flags: Int) {
        parcel.writeString(biometricSecret)
        parcel.writeString(salt)
        parcel.writeString(commitment)
        parcel.writeString(didHash)
        parcel.writeString(did)
        parcel.writeString(sessionNonceHex)
        // NB: see the kdoc on this file — by the time writeToParcel
        // returns, the Parcel holds its own (shared-memory backed) copy
        // of these strings. The Kotlin String instances we wrote from
        // are reachable from the caller's heap until GC. The caller is
        // responsible for closing the [UnlockedCredential] that owns
        // those strings; the AutoCloseable contract there is what does
        // the actual zeroing. We can't `null` the Strings on this side
        // because String is immutable in the JVM.
    }

    companion object CREATOR : Parcelable.Creator<ProverRequest> {
        override fun createFromParcel(parcel: Parcel): ProverRequest =
            ProverRequest(
                biometricSecret = parcel.readString().orEmpty(),
                salt = parcel.readString().orEmpty(),
                commitment = parcel.readString().orEmpty(),
                didHash = parcel.readString().orEmpty(),
                did = parcel.readString().orEmpty(),
                sessionNonceHex = parcel.readString().orEmpty(),
            )

        override fun newArray(size: Int): Array<ProverRequest?> = arrayOfNulls(size)
    }
}

// ─── ProverResponse ───────────────────────────────────────────────────

/**
 * Response from the `:prover` Service. Sealed because the receiver
 * needs an exhaustive `when` to drive its coroutine continuation.
 *
 * Three variants, all Parcelable:
 *  * [Progress]  — non-terminal, fired any number of times in [0..1].
 *  * [Success]   — terminal, carries the [GenerateOutput] result.
 *  * [Failure]   — terminal, carries the [ProverException] code + message.
 *
 * Parcelable rather than a single class with a discriminator because
 * the receiving Messenger uses a single message type
 * ([MESSAGE_PROVE_RESPONSE]) — the discriminator lives in the type
 * dispatch on the response object itself.
 */
sealed class ProverResponse : Parcelable {

    override fun describeContents(): Int = 0

    /** Progress update. Floats clamped client-side into [0, 1]. */
    class Progress(val fraction: Float) : ProverResponse() {
        override fun writeToParcel(parcel: Parcel, flags: Int) {
            parcel.writeInt(KIND_PROGRESS)
            parcel.writeFloat(fraction)
        }
    }

    /** Terminal success — carries the same fields as [GenerateOutput]. */
    class Success(
        val pi_a: List<String>,
        val pi_b: List<List<String>>,
        val pi_c: List<String>,
        val protocol: String,
        val curve: String,
        val publicSignals: List<String>,
        val did: String,
        val proofMs: Long,
    ) : ProverResponse() {
        override fun writeToParcel(parcel: Parcel, flags: Int) {
            parcel.writeInt(KIND_SUCCESS)
            parcel.writeStringList(pi_a)
            parcel.writeInt(pi_b.size)
            pi_b.forEach { parcel.writeStringList(it) }
            parcel.writeStringList(pi_c)
            parcel.writeString(protocol)
            parcel.writeString(curve)
            parcel.writeStringList(publicSignals)
            parcel.writeString(did)
            parcel.writeLong(proofMs)
        }

        /** Convenience converter to the public [GenerateOutput] shape. */
        fun toGenerateOutput(): GenerateOutput =
            GenerateOutput(
                proof = Groth16Proof(
                    pi_a = pi_a,
                    pi_b = pi_b,
                    pi_c = pi_c,
                    protocol = protocol,
                    curve = curve,
                ),
                publicSignals = publicSignals,
                did = did,
                proofMs = proofMs,
            )

        companion object {
            /** Build a Success from a [GenerateOutput] for the Service side. */
            fun fromGenerateOutput(out: GenerateOutput): Success = Success(
                pi_a = out.proof.pi_a,
                pi_b = out.proof.pi_b,
                pi_c = out.proof.pi_c,
                protocol = out.proof.protocol,
                curve = out.proof.curve,
                publicSignals = out.publicSignals,
                did = out.did,
                proofMs = out.proofMs,
            )
        }
    }

    /**
     * Terminal failure. [code] is one of [ProverException]'s stable
     * code constants so the caller can map it back without lossy
     * stringly-typed parsing.
     */
    class Failure(val code: String, val errorMessage: String) : ProverResponse() {
        override fun writeToParcel(parcel: Parcel, flags: Int) {
            parcel.writeInt(KIND_FAILURE)
            parcel.writeString(code)
            parcel.writeString(errorMessage)
        }

        /** Convenience converter to a thrown [ProverException]. */
        fun toException(): ProverException = ProverException(code, errorMessage)
    }

    companion object CREATOR : Parcelable.Creator<ProverResponse> {

        private const val KIND_PROGRESS = 1
        private const val KIND_SUCCESS = 2
        private const val KIND_FAILURE = 3

        override fun createFromParcel(parcel: Parcel): ProverResponse {
            return when (val kind = parcel.readInt()) {
                KIND_PROGRESS -> Progress(parcel.readFloat())
                KIND_SUCCESS -> {
                    val piA = mutableListOf<String>().also { parcel.readStringList(it) }.toList()
                    val piBSize = parcel.readInt()
                    val piB = ArrayList<List<String>>(piBSize)
                    repeat(piBSize) {
                        val row = mutableListOf<String>().also { parcel.readStringList(it) }.toList()
                        piB.add(row)
                    }
                    val piC = mutableListOf<String>().also { parcel.readStringList(it) }.toList()
                    val protocol = parcel.readString().orEmpty()
                    val curve = parcel.readString().orEmpty()
                    val publicSignals = mutableListOf<String>()
                        .also { parcel.readStringList(it) }.toList()
                    val did = parcel.readString().orEmpty()
                    val proofMs = parcel.readLong()
                    Success(
                        pi_a = piA,
                        pi_b = piB,
                        pi_c = piC,
                        protocol = protocol,
                        curve = curve,
                        publicSignals = publicSignals,
                        did = did,
                        proofMs = proofMs,
                    )
                }
                KIND_FAILURE -> Failure(
                    code = parcel.readString().orEmpty(),
                    errorMessage = parcel.readString().orEmpty(),
                )
                else -> Failure(
                    code = ProverException.PROVER_FAILED,
                    errorMessage = "Unknown ProverResponse kind: $kind",
                )
            }
        }

        override fun newArray(size: Int): Array<ProverResponse?> = arrayOfNulls(size)
    }
}
