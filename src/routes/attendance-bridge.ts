/**
 * /api/attendance/* — face-first office attendance bridge.
 *
 * The employee marks attendance from their OWN phone, which holds no
 * tenant API key (it must not). So attendance rides a public,
 * same-process bridge — exactly like /api/demo-portal/* — and the server
 * attaches the company's tenant context internally and reuses the
 * production proof-pairing verifier verbatim.
 *
 *   GET  /api/attendance/company        — anchor config for the phone
 *   POST /api/attendance/init           — open a pairing session, return nonce
 *   POST /api/attendance/record         — verify proof + WiFi gate, record event
 *
 * There is intentionally NO did-keyed status read: a public endpoint that
 * maps a (public) DID to a person's live in/out state is a presence-
 * enumeration oracle (security review Finding 1). The phone renders Home
 * from its own locally-tracked last action; the server stays the
 * auditable source of truth. An authenticated status read lands with the
 * slice-2 per-employee session.
 *
 * Identity verification is the EXACT proof-pairing path the W3 sign-in
 * uses (Poseidon nonce binding, commitment match, Groth16 verify, atomic
 * single-use consume — see src/services/proof-pairing.ts). Attendance
 * adds two things on top: a strict server-side WiFi-anchor re-check and
 * an attendance_events write (which carries its own audit hash-chain row
 * via createAttendanceEvent).
 *
 * Slice 1 reuses the demo-portal tenant as the single company ("Anchor
 * Corp"); any registered user is treated as an employee. HR
 * provision-then-claim membership is slice 2.
 *
 * Threat-model coverage (docs/threat_model.md A-41..A-43):
 *   - inherits A-11..A-26 from proof-pairing (nonce binding, replay,
 *     tenant isolation, enumeration, latency floor).
 *   - A-41 buddy-punch: identity is a real face proof bound to the
 *     device; an off-network attempt is still verified and recorded as a
 *     `rejected` row so HR sees the attempt.
 *   - A-42 mock-BSSID: the attested BSSID + signal are re-checked
 *     server-side against the configured anchor; a spoofed BSSID is the
 *     residual risk noted for the Play-Integrity hardening follow-up. We
 *     persist only the WiFi verdict (ok/reason/signal), never the raw
 *     office BSSID — no location identifier lands in the audit trail.
 *   - A-43 nonce replay: the pairing session is single-use; the bind
 *     token is consumed on the first /record, so a replay cannot
 *     re-verify.
 *
 * Acknowledged residuals (documented, not closed in slice 1): the
 * attendance.recorded audit write inherits createAttendanceEvent's
 * fire-and-forget posture (the attendance row itself is durable); and the
 * shared verifier degrades to a structural check only when NO vkey and NO
 * verifier loopback are configured — the seeded deployment loads the
 * ADR-pinned vkey (audit finding C-7), so the proof-of-knowledge layer is
 * in force. Both tighten to fail-closed before a non-demo BFSI tenant.
 */

import rateLimit from 'express-rate-limit';
import { Router, Request, Response } from 'express';
import { getPool } from '../services/db';
import { logger } from '../services/logger';
import { getTenantById, getTenantByEmail } from '../services/tenants';
import {
  createSession as pairingCreateSession,
  submitProof as pairingSubmitProof,
  PairingSessionNotFound,
  PairingSessionExpired,
  PairingSessionAlreadyBound,
  PairingSessionLocked,
  PairingSessionBindMismatch,
  PairingNonceMismatch,
  PairingDidUnknown,
  PairingProofInvalid,
  TooManyPendingSessions,
  PlayIntegrityRequired,
  PlayIntegrityInsufficient,
} from '../services/proof-pairing';
import {
  DEMO_PORTAL_TENANT_ID,
  DEMO_PORTAL_TENANT_EMAIL,
} from '../services/demo-portal-seed';
import { createAttendanceEvent } from '../services/platform';
import {
  getAttendanceCompany,
  verifyWifiAgainstAnchor,
  AttendanceCompany,
} from '../services/attendance-company';
import { ApiKeyEnvironment, AttendanceEventType } from '../types';

const router = Router();

/**
 * Environment the attendance company runs in. Locked to `live` for the
 * same reason as the demo-portal bridge: the demo-portal tenant's
 * deterministic `za_live_*` key means every registered user / session
 * lands in the `live` partition.
 */
const DEMO_ENVIRONMENT: ApiKeyEnvironment = 'live';

const SESSION_ID_SHAPE = /^[0-9a-fA-F-]{8,64}$/;
const ATTENDANCE_TYPES: AttendanceEventType[] = ['check_in', 'check_out'];
// Mirrors the registration-time DID format (src/services/identity.ts).
// Rejecting malformed DIDs before the verifier/SQL shrinks the surface.
const DID_PATTERN = /^did:zeroauth:[a-z0-9-]+:[a-f0-9]{20,80}$/i;

/**
 * Per-IP rate limit for the public attendance bridge (A-20). The bridge
 * is unauthenticated and shares a single tenant, so an `/init` flood
 * could otherwise exhaust MAX_PENDING_SESSIONS_PER_TENANT for the whole
 * workforce, and an `/record` flood could drive verifier CPU. 60/min/IP
 * matches the spirit of the production proof-pairing public-read cap.
 */
const attendanceLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Slow down and try again in a minute.' },
});
router.use(attendanceLimiter);

// ─── Tenant + api-key resolution (mirrors demo-portal.ts) ──────────────

let cachedTenantId: string | null = null;

async function resolveCompanyTenantId(): Promise<string | null> {
  if (cachedTenantId) return cachedTenantId;
  const deterministic = await getTenantById(DEMO_PORTAL_TENANT_ID).catch(() => null);
  if (deterministic) {
    cachedTenantId = deterministic.id;
    return deterministic.id;
  }
  const byEmail = await getTenantByEmail(DEMO_PORTAL_TENANT_EMAIL).catch(() => null);
  if (byEmail) {
    cachedTenantId = byEmail.id;
    return byEmail.id;
  }
  return null;
}

/**
 * The attendance company's active API key id — used only as the audit
 * actor for the attendance write. Cached ONLY when an actual key row is
 * resolved; a transient miss falls back to the tenant id for that one
 * call without caching, so a later successful lookup still wins and a
 * pre-seed race can't poison the audit actor for the process lifetime
 * (security review Finding 5).
 */
let cachedApiKeyId: string | null = null;

async function resolveApiKeyId(tenantId: string): Promise<string> {
  if (cachedApiKeyId) return cachedApiKeyId;
  try {
    const pool = getPool();
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM api_keys
         WHERE tenant_id = $1 AND status = 'active'
         ORDER BY created_at ASC
         LIMIT 1`,
      [tenantId],
    );
    const found = result.rows[0]?.id;
    if (found) {
      cachedApiKeyId = found;
      return found;
    }
  } catch {
    // fall through to the un-cached tenant-id stand-in below
  }
  return tenantId;
}

// ─── Bind-token cache (mirrors demo-portal.ts) ─────────────────────────
//
// pairingSubmitProof requires the session_bind token minted by
// createSession. The phone never holds it: we stash it server-side keyed
// by session id at /init and consume it (single-use) at /record. The
// plaintext never leaves the server.

const BIND_TOKEN_TTL_MS = 5 * 60 * 1000;

interface CachedBindToken {
  token: string;
  expiresAtMs: number;
}

const sessionBindTokenCache = new Map<string, CachedBindToken>();

function rememberBindToken(sessionId: string, token: string): void {
  sessionBindTokenCache.set(sessionId, {
    token,
    expiresAtMs: Date.now() + BIND_TOKEN_TTL_MS,
  });
}

function consumeBindToken(sessionId: string): string | null {
  const entry = sessionBindTokenCache.get(sessionId);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    sessionBindTokenCache.delete(sessionId);
    return null;
  }
  // Single-use: a replayed /record on the same session id cannot
  // re-verify (A-32).
  sessionBindTokenCache.delete(sessionId);
  return entry.token;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessionBindTokenCache.entries()) {
    if (entry.expiresAtMs <= now) sessionBindTokenCache.delete(id);
  }
}, 60_000).unref?.();

// ─── Helpers ───────────────────────────────────────────────────────────

function publicCompany(c: AttendanceCompany) {
  return {
    name: c.name,
    location: c.location,
    wifi: {
      ssidLabel: c.wifi.ssidLabel,
      bssids: c.wifi.bssids,
      minSignalPercent: c.wifi.minSignalPercent,
    },
  };
}

/** Map a proof-pairing error onto the documented HTTP status. Returns
 *  true when handled; false when the caller should surface a 500. */
function mapPairingError(err: unknown, res: Response): boolean {
  if (err instanceof PairingSessionNotFound) {
    res.status(404).json({ error: err.code, message: 'Pairing session not found.' });
  } else if (err instanceof PairingSessionExpired) {
    res.status(410).json({ error: err.code, message: 'Pairing session expired.' });
  } else if (err instanceof PairingSessionAlreadyBound) {
    res.status(409).json({ error: err.code, message: 'Pairing session already used.' });
  } else if (err instanceof PairingSessionLocked) {
    res.status(423).json({ error: err.code, message: 'Pairing session locked after repeated failures.' });
  } else if (err instanceof PairingSessionBindMismatch) {
    res.status(403).json({ error: err.code, message: 'Session bind mismatch.' });
  } else if (err instanceof PairingNonceMismatch) {
    res.status(400).json({ error: err.code, message: 'Public-signals nonce mismatch.' });
  } else if (err instanceof PairingDidUnknown) {
    res.status(400).json({ error: err.code, message: 'This identity is not enrolled for attendance.' });
  } else if (err instanceof PairingProofInvalid) {
    res.status(401).json({ error: err.code, message: 'Face proof verification failed.' });
  } else if (err instanceof PlayIntegrityRequired) {
    res.status(400).json({ error: err.code, message: (err as Error).message });
  } else if (err instanceof PlayIntegrityInsufficient) {
    res.status(401).json({ error: err.code, message: (err as Error).message });
  } else {
    return false;
  }
  return true;
}

// ─── Routes ────────────────────────────────────────────────────────────

/**
 * GET /api/attendance/company
 *
 * Public, read-only. The phone fetches the WiFi anchor so it can
 * auto-detect the company and run the local presence gate before
 * prompting for a face scan.
 */
router.get('/company', (_req: Request, res: Response) => {
  res.status(200).json({ company: publicCompany(getAttendanceCompany()) });
});

/**
 * POST /api/attendance/init
 *
 * Opens a fresh proof-pairing session against the company tenant and
 * returns the nonce the phone's prover binds the face proof to. The
 * session's bind token is stashed server-side; the phone only ever sees
 * the session id + nonce.
 */
router.post('/init', async (req: Request, res: Response) => {
  try {
    const tenantId = await resolveCompanyTenantId();
    if (!tenantId) {
      res.status(503).json({
        error: 'attendance_not_provisioned',
        message: 'Attendance is not yet provisioned on this deployment.',
      });
      return;
    }

    const result = await pairingCreateSession(
      tenantId,
      DEMO_ENVIRONMENT,
      null,
      req.ip ?? null,
      (req.headers['user-agent'] as string | undefined) ?? null,
    );
    rememberBindToken(result.id, result.sessionBindToken);

    res.status(201).json({
      sessionId: result.id,
      nonce: result.nonce,
      expiresAt: result.expiresAt,
      company: publicCompany(getAttendanceCompany()),
    });
  } catch (err) {
    if (err instanceof TooManyPendingSessions) {
      res.status(429).json({
        error: 'too_many_pending_sessions',
        message: 'Too many open attendance sessions. Try again in a minute.',
      });
      return;
    }
    logger.error('attendance: init failed', { error: (err as Error).message });
    res.status(500).json({ error: 'attendance_init_failed', message: 'Could not start an attendance session.' });
  }
});

/**
 * POST /api/attendance/record
 *
 * The phone POSTs the structured proof (no QR round-trip needed — this
 * is a native client) plus its WiFi reading. We verify the proof via the
 * exact proof-pairing path, then strictly re-check the WiFi anchor
 * server-side, then record the attendance event. An off-network attempt
 * with a valid face is recorded as `rejected` (the identity is real; the
 * presence is not) and returns 403.
 */
router.post('/record', async (req: Request, res: Response) => {
  try {
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
    const type = req.body?.type;
    const did = typeof req.body?.did === 'string' ? req.body.did : '';
    const proof = req.body?.proof;
    const publicSignals = req.body?.publicSignals;
    const wifi = (req.body?.wifi ?? {}) as { bssid?: unknown; signal?: unknown };
    const clientMetaIn = (req.body?.clientMeta ?? {}) as Record<string, unknown>;

    // ── Validation (before consuming the single-use session token) ──
    if (!sessionId || !SESSION_ID_SHAPE.test(sessionId)) {
      res.status(400).json({ error: 'invalid_request', message: 'sessionId is required and must be a UUID.' });
      return;
    }
    if (!type || !ATTENDANCE_TYPES.includes(type)) {
      res.status(400).json({ error: 'invalid_type', message: 'type must be check_in or check_out.' });
      return;
    }
    if (!did || !DID_PATTERN.test(did)) {
      res.status(400).json({ error: 'invalid_request', message: 'A valid did is required.' });
      return;
    }
    if (!proof || typeof proof !== 'object'
        || !Array.isArray(publicSignals) || publicSignals.length !== 3
        || publicSignals.some((s) => typeof s !== 'string')) {
      res.status(400).json({ error: 'invalid_request', message: 'proof + 3-element publicSignals are required.' });
      return;
    }

    const tenantId = await resolveCompanyTenantId();
    if (!tenantId) {
      res.status(503).json({ error: 'attendance_not_provisioned', message: 'Attendance is not yet provisioned.' });
      return;
    }

    const bindToken = consumeBindToken(sessionId);
    if (!bindToken) {
      res.status(410).json({
        error: 'attendance_session_expired',
        message: 'This attendance session has expired or was already used. Start again.',
      });
      return;
    }

    // ── Identity: the exact proof-pairing verifier (A-11..A-26) ──
    let userId: string;
    try {
      const result = await pairingSubmitProof(
        sessionId,
        tenantId,
        DEMO_ENVIRONMENT,
        did,
        proof,
        publicSignals,
        clientMetaIn,
        bindToken,
      );
      userId = result.session.userId ?? '';
    } catch (err) {
      if (mapPairingError(err, res)) return;
      throw err;
    }
    if (!userId) {
      res.status(500).json({ error: 'attendance_record_failed', message: 'Verified session had no user.' });
      return;
    }

    // ── Presence: strict server-side WiFi anchor re-check ──
    const company = getAttendanceCompany();
    const verdict = verifyWifiAgainstAnchor(
      {
        bssid: typeof wifi.bssid === 'string' ? wifi.bssid : null,
        signal: typeof wifi.signal === 'number' ? wifi.signal : null,
      },
      company.wifi,
    );

    const apiKeyId = await resolveApiKeyId(tenantId);
    const event = await createAttendanceEvent(tenantId, DEMO_ENVIRONMENT, apiKeyId, {
      userId,
      type,
      result: verdict.ok ? 'accepted' : 'rejected',
      metadata: {
        source: 'attendance-bridge',
        // Only the WiFi verdict is persisted — never the raw office BSSID,
        // so no location identifier lands in the immutable audit trail
        // (security review Finding 3 / DPDP minimisation). wifi_ok +
        // wifi_reason are the decision inputs; signal is non-identifying.
        wifi_signal: typeof wifi.signal === 'number' ? wifi.signal : null,
        wifi_ok: verdict.ok,
        wifi_reason: verdict.reason ?? null,
        proofMs: typeof clientMetaIn.proofMs === 'number' ? clientMetaIn.proofMs : null,
      },
    });

    if (!verdict.ok) {
      res.status(403).json({
        error: 'outside_anchor',
        reason: verdict.reason,
        message: 'You are not on the office network. Attendance was not marked.',
      });
      return;
    }

    res.status(201).json({
      ok: true,
      type: event.event_type,
      result: event.result,
      occurredAt: event.occurred_at,
    });
  } catch (err) {
    logger.error('attendance: record failed', { error: (err as Error).message });
    res.status(500).json({ error: 'attendance_record_failed', message: 'Could not record attendance.' });
  }
});

export default router;
