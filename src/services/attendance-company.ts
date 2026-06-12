/**
 * src/services/attendance-company.ts
 *
 * Attendance "company" config + WiFi presence anchor for the face-first
 * office attendance flow (slice 1).
 *
 * Slice 1 reuses the demo-portal tenant as the single seeded company
 * ("Anchor Corp"): any user registered in that tenant — i.e. anyone who
 * can sign in — is treated as an employee. Per-company membership
 * (HR provision-then-claim) is slice 2.
 *
 * The WiFi anchor IS the presence gate. The phone reports the BSSID +
 * signal% of the network it is connected to; the server re-checks it
 * against the configured anchor before recording an attendance event.
 * No GPS, no continuous location — only a yes/no "on the office network"
 * attestation. The BSSID (the router's MAC) is the real anchor; the
 * spoofable SSID rides along only as a human-readable label.
 *
 * Config is env-overridable so an operator can point the anchor at the
 * real office network without a redeploy (and so a tester can set it to
 * their own network to exercise the strict gate locally):
 *
 *   ATTENDANCE_COMPANY_NAME      (default "Anchor Corp")
 *   ATTENDANCE_LOCATION_LABEL    (default "Anchor Corp HQ")
 *   ATTENDANCE_WIFI_SSID_LABEL   (default "AnchorCorp-Office")
 *   ATTENDANCE_WIFI_BSSIDS       comma-separated MACs (default "")
 *   ATTENDANCE_WIFI_MIN_SIGNAL   integer percent 0..100 (default 85)
 *
 * The shape is deliberately the one the slice-3 admin dashboard will
 * write per-company; for now it is a single env-backed record.
 */

export interface AttendanceWifiAnchor {
  /** Human-readable network name. Spoofable — never the security anchor. */
  ssidLabel: string;
  /** Allowed router MACs (lower-cased). Empty = no anchor configured. */
  bssids: string[];
  /** Minimum signal strength, percent 0..100 (the user's "85%"). */
  minSignalPercent: number;
}

export interface AttendanceCompany {
  name: string;
  location: string;
  wifi: AttendanceWifiAnchor;
}

export interface ReportedWifi {
  bssid?: string | null;
  /** Signal strength as a percent 0..100 (WifiManager.calculateSignalLevel). */
  signal?: number | null;
}

export type WifiRejectReason =
  | 'no_anchor_configured'
  | 'missing_reading'
  | 'bssid_mismatch'
  | 'weak_signal';

export interface WifiVerdict {
  ok: boolean;
  reason?: WifiRejectReason;
}

/** Lower-case + trim a BSSID so `AA:BB` and `aa:bb` compare equal. */
function normaliseBssid(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Resolve the current attendance company config from the environment.
 * Read at call-time (not module-load) so an operator's env change — or a
 * test's `process.env` override — takes effect without a process
 * restart. Cheap enough to call per request.
 */
export function getAttendanceCompany(): AttendanceCompany {
  const bssids = (process.env.ATTENDANCE_WIFI_BSSIDS ?? '')
    .split(',')
    .map(normaliseBssid)
    .filter((s) => s.length > 0);

  const minRaw = parseInt(process.env.ATTENDANCE_WIFI_MIN_SIGNAL ?? '85', 10);
  const minSignalPercent = Number.isFinite(minRaw)
    ? Math.min(100, Math.max(0, minRaw))
    : 85;

  return {
    name: process.env.ATTENDANCE_COMPANY_NAME ?? 'Anchor Corp',
    location: process.env.ATTENDANCE_LOCATION_LABEL ?? 'Anchor Corp HQ',
    wifi: {
      ssidLabel: process.env.ATTENDANCE_WIFI_SSID_LABEL ?? 'AnchorCorp-Office',
      bssids,
      minSignalPercent,
    },
  };
}

/**
 * Strict, real presence check. Returns `{ ok: true }` only when the
 * reported network is one of the configured anchor BSSIDs AND the
 * reported signal meets the minimum percent. Every failure carries a
 * machine reason for the audit trail.
 *
 * An unconfigured anchor (no BSSIDs) can never attest presence — we
 * fail closed. This is the real-product posture: a company that hasn't
 * set its office network simply cannot record geofenced attendance yet.
 */
export function verifyWifiAgainstAnchor(
  reported: ReportedWifi,
  anchor: AttendanceWifiAnchor,
): WifiVerdict {
  if (!anchor.bssids || anchor.bssids.length === 0) {
    return { ok: false, reason: 'no_anchor_configured' };
  }
  const bssid = typeof reported.bssid === 'string' ? normaliseBssid(reported.bssid) : '';
  const signal = typeof reported.signal === 'number' ? reported.signal : NaN;
  if (!bssid || !Number.isFinite(signal)) {
    return { ok: false, reason: 'missing_reading' };
  }
  if (!anchor.bssids.includes(bssid)) {
    return { ok: false, reason: 'bssid_mismatch' };
  }
  if (signal < anchor.minSignalPercent) {
    return { ok: false, reason: 'weak_signal' };
  }
  return { ok: true };
}
