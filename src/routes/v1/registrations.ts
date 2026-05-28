/**
 * End-user registration ceremony — the three-QR signup flow (ADR 0023).
 *
 * Two surfaces on one router:
 *
 *   1. Tenant-API-key authed routes for the org's SDK:
 *        POST   /v1/registrations                     — start session
 *        GET    /v1/registrations/:id                 — poll status
 *        DELETE /v1/registrations/:id                 — abandon
 *
 *   2. Unauthenticated routes for the phone (the code is the bearer):
 *        POST   /v1/registrations/pair-device         — step 1
 *        POST   /v1/registrations/submit-commitment   — step 2
 *        POST   /v1/registrations/complete            — step 3
 *
 *   The phone-side routes are rate-limited per-IP via the same
 *   pgRateLimit middleware that gates /v1/devices/enroll. Each route
 *   is enumerated in tests/tenant-isolation.test.ts as an explicit
 *   PUBLIC_ROUTE_EXCEPTION with a documented reason.
 */

import { Router, Request, Response } from 'express';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import { pgRateLimit } from '../../middleware/rate-limit';
import {
  abandonRegistration,
  completeRegistration,
  getRegistrationSession,
  pairDeviceForRegistration,
  RegistrationStateError,
  startRegistration,
  submitCommitmentForRegistration,
} from '../../services/registration';
import { verifyProofOffChain } from '../../services/zkp';

const router = Router();

const phoneSideRateLimit = pgRateLimit({
  route: 'registrations:phone',
  windowMs: 60 * 1000,
  max: 20,
  keyBy: 'ip',
});

// ─── Tenant-side surfaces ─────────────────────────────────────────

/**
 * POST /v1/registrations — start a new signup ceremony.
 *
 * Body: `{ profile?: object }`. The profile blob is opaque to the
 * server beyond a defence-in-depth strip of any key whose name
 * suggests raw biometric data (see sanitizeProfile in
 * src/services/registration.ts).
 *
 * Response:
 *   201 { session, pair: { code, expires_at, deeplink } }
 */
router.post('/',
  authenticateTenantApiKey(['users:write']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const result = await startRegistration(
        tenant.id,
        apiKey.environment,
        { profile: req.body?.profile },
        { type: 'api_key', id: apiKey.id },
      );
      res.status(201).json({
        session: redactSensitive(result.session),
        pair: {
          code: result.pairCode,
          expires_at: result.pairCodeExpiresAt.toISOString(),
          deeplink: result.pairDeeplink,
        },
      });
    } catch (err) {
      res.status(500).json({ error: 'registration_start_failed', message: (err as Error).message });
    }
  },
);

/**
 * GET /v1/registrations/:id — poll the current state of a session.
 *
 * The platform calls this after rendering each QR to know when to
 * advance the wizard. The response contains the state machine value
 * plus the non-sensitive fields the UI needs (device_id, did,
 * tenant_user_id once each is bound).
 *
 * The plaintext codes and the challenge_nonce are NEVER in this
 * response — they're returned only once at issuance time.
 */
router.get('/:id',
  authenticateTenantApiKey(['users:read']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const session = await getRegistrationSession(tenant.id, apiKey.environment, req.params.id);
      if (!session) {
        res.status(404).json({ error: 'session_not_found' });
        return;
      }
      res.status(200).json({ session: redactSensitive(session) });
    } catch (err) {
      res.status(500).json({ error: 'registration_poll_failed', message: (err as Error).message });
    }
  },
);

/**
 * DELETE /v1/registrations/:id — abandon (soft-cancel) a session.
 *
 * Voids all outstanding codes and flips state to 'abandoned'. A
 * completed session is unchanged (idempotent). Useful for "user
 * closed the tab" flows the tenant SDK detects.
 */
router.delete('/:id',
  authenticateTenantApiKey(['users:write']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const session = await abandonRegistration(
        tenant.id,
        apiKey.environment,
        req.params.id,
        { type: 'api_key', id: apiKey.id },
      );
      if (!session) {
        res.status(404).json({ error: 'session_not_found' });
        return;
      }
      res.status(200).json({ session: redactSensitive(session) });
    } catch (err) {
      res.status(500).json({ error: 'registration_abandon_failed', message: (err as Error).message });
    }
  },
);

// ─── Phone-side surfaces (no tenant API key — code IS the bearer) ─

/**
 * POST /v1/registrations/pair-device — step 1.
 *
 * Body: `{ pair_code, fingerprint, attestation_kind? }`.
 *
 * Validates the code against an awaiting_device row, claims a device
 * row (reusing ADR 0022 fingerprint binding), attaches device_id to
 * the session, mints the next code (enroll_code) + returns the
 * deeplink the phone shows the operator: "Now scan QR2 on the
 * platform".
 *
 * Failure modes (uniform 404 envelope to avoid enumeration):
 *   - unknown / expired pair_code
 *   - invalid fingerprint (< 16 chars)
 *   - session expired
 */
router.post('/pair-device', phoneSideRateLimit, async (req: Request, res: Response) => {
  try {
    const { pair_code, fingerprint, attestation_kind } = req.body ?? {};
    if (typeof pair_code !== 'string' || pair_code.length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'pair_code is required' });
      return;
    }
    if (typeof fingerprint !== 'string' || fingerprint.length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'fingerprint is required' });
      return;
    }
    if (attestation_kind !== undefined && typeof attestation_kind !== 'string') {
      res.status(400).json({ error: 'invalid_request', message: 'attestation_kind must be a string' });
      return;
    }
    const result = await pairDeviceForRegistration({
      pairCode: pair_code,
      fingerprint,
      attestationKind: attestation_kind,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json({
      session_id: result.session.id,
      device_id: result.session.device_id,
      // Phone gets back the enroll_code so it knows what to look for
      // when it scans QR2 — but more usefully, the next deeplink it
      // would expect (which it matches against the QR payload).
      next: {
        step: 'enroll',
        code: result.nextCode,
        expires_at: result.nextCodeExpiresAt.toISOString(),
        deeplink: result.nextDeeplink,
      },
    });
  } catch (err) {
    if (err instanceof RegistrationStateError) {
      res.status(404).json({ error: 'pair_failed' });
      return;
    }
    res.status(500).json({ error: 'pair_failed', message: (err as Error).message });
  }
});

/**
 * POST /v1/registrations/submit-commitment — step 2.
 *
 * Body: `{ enroll_code, did, commitment, attestation_kind? }`.
 *
 * Stores (did, commitment) on the session row. Mints verify_code +
 * challenge_nonce. Returns the verify deeplink (with the challenge
 * baked in) so the phone can match against QR3.
 *
 * The commitment is the Poseidon hash of the on-device secret —
 * non-secret, non-PII (DPDP §2(t) memo). The biometric NEVER touches
 * the server side.
 */
router.post('/submit-commitment', phoneSideRateLimit, async (req: Request, res: Response) => {
  try {
    const { enroll_code, did, commitment, attestation_kind } = req.body ?? {};
    if (typeof enroll_code !== 'string' || enroll_code.length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'enroll_code is required' });
      return;
    }
    if (typeof did !== 'string' || did.length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'did is required' });
      return;
    }
    if (typeof commitment !== 'string' || commitment.length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'commitment is required' });
      return;
    }
    const result = await submitCommitmentForRegistration({
      enrollCode: enroll_code,
      did,
      commitment,
      attestationKind: typeof attestation_kind === 'string' ? attestation_kind : undefined,
    });
    res.status(200).json({
      session_id: result.session.id,
      next: {
        step: 'verify',
        code: result.nextCode,
        expires_at: result.nextCodeExpiresAt.toISOString(),
        deeplink: result.nextDeeplink,
        challenge_nonce: result.challengeNonce,
      },
    });
  } catch (err) {
    if (err instanceof RegistrationStateError) {
      const reason = err.reason;
      if (reason === 'invalid_commitment') {
        res.status(400).json({ error: 'invalid_request', message: 'did or commitment shape is invalid' });
        return;
      }
      res.status(404).json({ error: 'enroll_failed' });
      return;
    }
    res.status(500).json({ error: 'enroll_failed', message: (err as Error).message });
  }
});

/**
 * POST /v1/registrations/complete — step 3.
 *
 * Body: `{ verify_code, challenge_nonce, proof, public_signals }`.
 *
 * Atomic: validate code, validate challenge_nonce matches what we
 * issued at step 2, verify the Groth16 proof, assert
 * publicSignals[0] equals the stored commitment, create the
 * tenant_user, flip state to completed.
 *
 * Returns 200 `{ session_id, tenant_user, device }` on success. All
 * failure modes other than malformed input return 404
 * `verify_failed` to avoid leaking which condition tripped.
 */
router.post('/complete', phoneSideRateLimit, async (req: Request, res: Response) => {
  try {
    const { verify_code, challenge_nonce, proof, public_signals } = req.body ?? {};
    if (typeof verify_code !== 'string' || verify_code.length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'verify_code is required' });
      return;
    }
    if (typeof challenge_nonce !== 'string' || challenge_nonce.length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'challenge_nonce is required' });
      return;
    }
    if (!proof || typeof proof !== 'object') {
      res.status(400).json({ error: 'invalid_request', message: 'proof is required' });
      return;
    }
    if (!Array.isArray(public_signals)) {
      res.status(400).json({ error: 'invalid_request', message: 'public_signals is required' });
      return;
    }

    const result = await completeRegistration(
      {
        verifyCode: verify_code,
        challengeNonce: challenge_nonce,
        proof,
        publicSignals: public_signals,
      },
      // Real verifier — accepts (proof, publicSignals) and returns
      // boolean. Reuses the existing zkp.ts entry that runs the
      // off-chain Groth16 verify path (or the verifier service when
      // the operator has opted in).
      (p, s) => verifyProofOffChain(p as never, s as string[]),
    );

    res.status(200).json({
      session_id: result.session.id,
      tenant_user: result.tenantUser,
      device: result.device,
    });
  } catch (err) {
    if (err instanceof RegistrationStateError) {
      res.status(404).json({ error: 'verify_failed' });
      return;
    }
    res.status(500).json({ error: 'verify_failed', message: (err as Error).message });
  }
});

/**
 * Tenant-side responses MUST NOT leak the pending code hashes or
 * the challenge_nonce — those are bearer-grade secrets the platform
 * was supposed to render into a QR and forget. We strip them at the
 * route boundary.
 */
function redactSensitive(session: object): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pair_code_hash, enroll_code_hash, verify_code_hash, verify_challenge_nonce, ...safe } =
    session as Record<string, unknown>;
  return safe;
}

export default router;
