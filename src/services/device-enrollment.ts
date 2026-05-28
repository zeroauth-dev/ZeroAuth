/**
 * Device enrollment primitives (ADR 0022).
 *
 * The production device-enrollment flow is a two-step handshake:
 *
 *   1. Admin opens the dashboard, fills in a name + device type +
 *      optional location, and clicks "Register device". The console
 *      route (POST /api/console/devices) calls `issueEnrollmentCode`
 *      which inserts the row in `pending` state and returns the
 *      *plaintext* code to the dashboard exactly once. The row only
 *      ever stores `enrollment_code_hash = SHA-256(code)`.
 *
 *   2. The device opens the ZeroAuth companion app or kiosk firmware,
 *      reads/scans the code, and POSTs to /v1/devices/enroll with
 *      `{ enrollment_code, fingerprint, attestation? }`. The tenant
 *      API route calls `claimDeviceWithCode` which:
 *        - looks up the pending row by SHA-256(code);
 *        - checks expiry;
 *        - binds the device's fingerprint hash;
 *        - flips the row to `enrolled` and clears the code hash;
 *        - returns the row (and the device_token used for heartbeats).
 *
 * The plaintext code is short enough to type on a kiosk keypad
 * (12 chars in Crockford-base32, excluding `0/O/I/L/U`) and lives
 * outside the server side after the response is delivered. The hash
 * is what we look up; brute force is bounded by the 15-minute TTL +
 * per-IP rate limit on /v1/devices/enroll (10 req/min in app.ts).
 *
 * Why no full Play Integrity verification here? V1 only *records*
 * the attestation kind + blob in audit_events.metadata. Verification
 * of Play Integrity verdict signatures (and App Attest assertions)
 * lands in Phase 1 Sprint 4 on the path already used by the proof-
 * pairing flow (src/services/play-integrity.ts).
 */

import crypto from 'crypto';

/** SHA-256 hex, lower-case. The single hash function we use here. */
export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Generate a human-typeable one-time enrollment code.
 *
 * Format: `ZA-XXXX-XXXX` where each X is from Crockford base-32 minus
 * the visually-ambiguous letters `O`, `I`, `L`, `U` (and digit `0`,
 * `1` which look like `O`/`I`). That leaves 27 symbols × 8 positions
 * = log2(27^8) ≈ 38 bits of entropy. Combined with a 15-minute TTL
 * and 10-req/min/IP rate limit, that's >> 2^25 in expected guesses to
 * land one collision — overkill for a code with a 900-second window.
 *
 * The `ZA-` prefix is a sentinel for paste-detection in the device
 * firmware and a small signal to non-technical users that this is
 * "a ZeroAuth code, not a 2FA code".
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'; // 30 chars; no 0/1/I/L/O/U
const CODE_GROUP_LEN = 4;
const CODE_GROUPS = 2;

export function generateEnrollmentCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < CODE_GROUPS; g++) {
    let group = '';
    // crypto.randomInt is uniform; preferring it over Math.random().
    for (let i = 0; i < CODE_GROUP_LEN; i++) {
      group += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
    groups.push(group);
  }
  return `ZA-${groups.join('-')}`;
}

/**
 * Normalise a code as keyed by the device (kiosk operators sometimes
 * type lowercase, sometimes drop hyphens). We trim whitespace,
 * upper-case, and re-inject the expected hyphens — but only if the
 * input shape is plausibly a ZeroAuth enrollment code. Anything
 * unrecognised returns the trimmed-and-uppered input as-is so the
 * downstream hash compare fails and the caller returns the same
 * 404-like "not_found_or_expired" response (no enumeration signal).
 */
export function normaliseEnrollmentCode(raw: string): string {
  const stripped = raw.trim().toUpperCase().replace(/[\s-]+/g, '');
  if (stripped.startsWith('ZA') && stripped.length === 2 + CODE_GROUPS * CODE_GROUP_LEN) {
    const body = stripped.slice(2);
    const re = new RegExp(`.{1,${CODE_GROUP_LEN}}`, 'g');
    return `ZA-${body.match(re)!.join('-')}`;
  }
  return stripped;
}

export const ENROLLMENT_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** SHA-256 hash of the device-supplied fingerprint. */
export function fingerprintHash(fingerprint: string): string {
  return sha256Hex(fingerprint);
}

/**
 * Validate a device-supplied fingerprint string. We require >= 16
 * bytes of opaque input so a misconfigured client can't just send
 * "default" and bind to the row trivially. The fingerprint format is
 * device-type-specific:
 *
 *   mobile_android — android_id + Play Integrity package + nonce
 *   mobile_ios     — identifierForVendor + App Attest keyId
 *   kiosk          — kiosk serial number + MAC address
 *   iot_bridge     — bridge UUID + USB serial of the R307 sensor
 *
 * The verifier doesn't care about the shape — only that the device
 * sends the *same* fingerprint each time. The hash is what we store,
 * so the plaintext shape can evolve per device class.
 */
export function isValidFingerprint(fp: unknown): fp is string {
  return typeof fp === 'string' && fp.trim().length >= 16 && fp.length <= 4096;
}
