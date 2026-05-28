package dev.zeroauth.sensors.r307

/**
 * The R307 USB-OTG fingerprint sensor surface.
 *
 * The interface here is intentionally narrow at C-101 (scaffold). It
 * will widen with C-145 to cover the full GETIMAGE → GENCHAR →
 * REGMODEL → STORECHAR round-trip described in
 * `docs/plan/bfsi-v1/02-bank-demo.md` Scene 1.
 *
 * ### Contract
 *
 * @return a hex-encoded SHA-256 digest of the on-device fingerprint
 *   template descriptor. The raw template bytes are zeroed before the
 *   function returns; only the hash is exposed across the module
 *   boundary. This matches the CLAUDE.md non-goal "never log
 *   biometric-derived raw data" and the Scene 1 acceptance criterion
 *   that "the template descriptor is hashed on-device".
 *
 * ### Threading
 *
 * `captureFingerprintHash` is blocking; the USB round-trip alone is
 * 1.5–4 s on the tier-1 SKU matrix. Callers MUST invoke on a
 * background dispatcher.
 *
 * ### Implementation map
 *
 * | Commit | What changes |
 * |--------|--------------|
 * | C-101  | This interface + DefaultR307Driver throwing stub.            |
 * | C-145  | Real USB host enumeration + R307 protocol framing + tests.   |
 */
interface R307Driver {

    /**
     * Capture a fingerprint from the connected R307 sensor and return
     * a hex SHA-256 of the on-device template descriptor.
     */
    fun captureFingerprintHash(): String
}

/**
 * Default [R307Driver] implementation — a throwing stub.
 *
 * Any code path that calls [captureFingerprintHash] today crashes
 * loudly with `NotImplementedError`. Real implementation lands with
 * C-145 (see [R307Driver]).
 */
class DefaultR307Driver : R307Driver {

    override fun captureFingerprintHash(): String {
        throw NotImplementedError("Real R307 driver lands in C-145")
    }
}
