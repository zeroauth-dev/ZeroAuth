/**
 * /v1/proof-pairing/* — W3, ADR-0009.
 *
 * Thin HTTP adapter around `src/services/proof-pairing.ts`. The
 * service does the actual work (Poseidon re-derivation, atomic
 * consume, audit-row writes); the route layer reads the session_bind
 * cookie, sets it on the response for new sessions, and maps service
 * errors onto the documented HTTP status codes (see
 * `docs/error_codes.md` § "Proof pairing").
 */

import { Router, Request, Response } from 'express';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import { logger } from '../../services/logger';
import {
  createSession,
  submitProof,
  getSession,
  subscribeStream,
  streamHeartbeatMs,
  PairingSessionNotFound,
  PairingSessionExpired,
  PairingSessionAlreadyBound,
  PairingSessionLocked,
  PairingSessionBindMismatch,
  PairingNonceMismatch,
  PairingDidUnknown,
  PairingProofInvalid,
  PairingTenantMismatch,
  TooManyPendingSessions,
  VerifierUnavailable,
  StreamEvent,
} from '../../services/proof-pairing';
import { Groth16Proof } from '../../types';

const router = Router();

const PAIR_COOKIE = 'zeroauth_pair_bind';
const COOKIE_PATH = '/v1/proof-pairing/';
const COOKIE_MAX_AGE_SEC = 300; // 5 min — matches SESSION_TTL_MS

// ─── Helpers ───────────────────────────────────────────────────────────

function buildSetCookie(value: string): string {
  return (
    `${PAIR_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict;`
    + ` Path=${COOKIE_PATH}; Max-Age=${COOKIE_MAX_AGE_SEC}`
  );
}

function readBindCookie(req: Request): string | undefined {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies && typeof cookies[PAIR_COOKIE] === 'string') {
    return cookies[PAIR_COOKIE];
  }
  // Fallback: hand-parse the Cookie header. cookie-parser handles
  // common cases; this defends against middleware-order drift.
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === PAIR_COOKIE) return rest.join('=');
  }
  return undefined;
}

interface MappedError {
  status: number;
  error: string;
  message: string;
}

function mapError(err: unknown): MappedError {
  if (err instanceof PairingSessionNotFound) {
    return { status: 404, error: err.code, message: 'Pairing session not found.' };
  }
  if (err instanceof PairingSessionExpired) {
    return { status: 410, error: err.code, message: 'Pairing session expired.' };
  }
  if (err instanceof PairingSessionAlreadyBound) {
    return { status: 409, error: err.code, message: 'Pairing session already bound.' };
  }
  if (err instanceof PairingSessionLocked) {
    return { status: 423, error: err.code, message: 'Pairing session locked.' };
  }
  if (err instanceof PairingSessionBindMismatch) {
    return { status: 403, error: err.code, message: 'Session bind cookie missing or mismatched.' };
  }
  if (err instanceof PairingNonceMismatch) {
    return { status: 400, error: err.code, message: 'Public signals nonce mismatch.' };
  }
  if (err instanceof PairingDidUnknown) {
    return { status: 400, error: err.code, message: 'DID does not resolve for this tenant.' };
  }
  if (err instanceof PairingProofInvalid) {
    return { status: 401, error: err.code, message: 'Proof verification failed.' };
  }
  if (err instanceof PairingTenantMismatch) {
    return { status: 403, error: err.code, message: 'Session belongs to another tenant.' };
  }
  if (err instanceof TooManyPendingSessions) {
    return { status: 429, error: err.code, message: 'Too many open pairing sessions for this tenant.' };
  }
  if (err instanceof VerifierUnavailable) {
    return { status: 503, error: err.code, message: 'Verifier loopback unavailable. Retry shortly.' };
  }
  return { status: 500, error: 'pairing_failed', message: 'Pairing failed.' };
}

// ─── Routes ────────────────────────────────────────────────────────────

router.post('/sessions',
  authenticateTenantApiKey(['proof_pairing:create']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const result = await createSession(
        tenant.id,
        apiKey.environment,
        apiKey.id,
        req.ip ?? null,
        (req.headers['user-agent'] as string | undefined) ?? null,
      );

      res.setHeader('Set-Cookie', buildSetCookie(result.sessionBindToken));
      res.status(201).json({
        session: {
          id: result.id,
          nonce: result.nonce,
          expiresAt: result.expiresAt,
          qrPayload: result.qrPayload,
          streamUrl: `/v1/proof-pairing/sessions/${result.id}/stream`,
          state: 'issued',
        },
      });
    } catch (err) {
      const mapped = mapError(err);
      if (mapped.status === 500) {
        logger.error('proof-pairing: createSession failed', { error: (err as Error).message });
      }
      res.status(mapped.status).json({ error: mapped.error, message: mapped.message });
    }
  },
);

router.post('/sessions/:id/submit',
  authenticateTenantApiKey(['proof_pairing:claim']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const sessionId = String(req.params.id);
      const { did, proof, publicSignals, clientMeta } = req.body ?? {};

      if (typeof did !== 'string' || did.length === 0) {
        res.status(400).json({ error: 'invalid_request', message: 'did is required' });
        return;
      }
      if (!proof || typeof proof !== 'object') {
        res.status(400).json({ error: 'invalid_request', message: 'proof is required' });
        return;
      }
      if (!Array.isArray(publicSignals) || publicSignals.length !== 3) {
        res.status(400).json({
          error: 'invalid_request',
          message: 'publicSignals must be a 3-element array',
        });
        return;
      }

      const bindToken = readBindCookie(req);
      const result = await submitProof(
        sessionId,
        tenant.id,
        apiKey.environment,
        did,
        proof as Groth16Proof,
        publicSignals as string[],
        (clientMeta && typeof clientMeta === 'object') ? clientMeta : {},
        bindToken,
      );

      res.status(200).json(result);
    } catch (err) {
      const mapped = mapError(err);
      if (mapped.status === 500) {
        logger.error('proof-pairing: submitProof failed', { error: (err as Error).message });
      }
      res.status(mapped.status).json({ error: mapped.error, message: mapped.message });
    }
  },
);

router.get('/sessions/:id/stream',
  authenticateTenantApiKey(['proof_pairing:create']),
  async (req: Request, res: Response) => {
    const { tenant, apiKey } = getTenantContext(req);
    const sessionId = String(req.params.id);
    const bindToken = readBindCookie(req);

    // Build the iterator. subscribeStream is an async generator —
    // calling it doesn't actually execute anything yet; we have to
    // pull the first value to surface auth-gate errors as JSON 4xx
    // (not as an SSE frame, since headers haven't been written yet).
    const iter = subscribeStream(sessionId, tenant.id, apiKey.environment, bindToken);

    let firstEvent: IteratorResult<StreamEvent>;
    try {
      firstEvent = await iter.next();
    } catch (err) {
      const mapped = mapError(err);
      res.status(mapped.status).json({ error: mapped.error, message: mapped.message });
      return;
    }

    // SSE headers — *only* after the auth gate passes.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'Connection': 'keep-alive',
    });

    const heartbeat: NodeJS.Timeout = setInterval(() => {
      // Comment-only heartbeat per SSE spec — keeps Caddy + other
      // proxies from idling the connection. The leading colon makes
      // browsers ignore the line.
      res.write(': heartbeat\n\n');
    }, streamHeartbeatMs);

    const cleanup = (): void => {
      clearInterval(heartbeat);
    };
    req.on('close', cleanup);

    try {
      // Emit the first event, then drain the rest until terminal.
      if (!firstEvent.done) {
        const evt = firstEvent.value;
        res.write(`event: ${evt.event}\n`);
        res.write(`data: ${JSON.stringify(evt.data)}\n\n`);
        if (evt.event === 'session_created') {
          for await (const next of iter) {
            res.write(`event: ${next.event}\n`);
            res.write(`data: ${JSON.stringify(next.data)}\n\n`);
            if (next.event !== 'session_created') break;
          }
        }
      }
    } catch (err) {
      // Headers are out; surface the error via the SSE channel.
      const mapped = mapError(err);
      res.write(`event: session_error\n`);
      res.write(`data: ${JSON.stringify({ error: mapped.error, message: mapped.message })}\n\n`);
    } finally {
      cleanup();
      res.end();
    }
  },
);

router.get('/sessions/:id',
  authenticateTenantApiKey(['proof_pairing:create']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const sessionId = String(req.params.id);
      const bindToken = readBindCookie(req);
      const session = await getSession(sessionId, tenant.id, apiKey.environment, bindToken);
      res.status(200).json({ session });
    } catch (err) {
      const mapped = mapError(err);
      if (mapped.status === 500) {
        logger.error('proof-pairing: getSession failed', { error: (err as Error).message });
      }
      res.status(mapped.status).json({ error: mapped.error, message: mapped.message });
    }
  },
);

export default router;
