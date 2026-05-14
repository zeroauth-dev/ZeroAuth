import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { initVerifier, verifyProof, isVkeyLoaded } from './groth16';
import { logger } from './logger';
import { VerifyRequest, VerifyResponse, HealthResponse } from './types';

const PORT = parseInt(process.env.VERIFIER_PORT ?? '3001', 10);
const BIND = process.env.VERIFIER_BIND ?? '127.0.0.1';
const VKEY_PATH =
  process.env.VERIFIER_VKEY_PATH ?? 'circuits/build/verification_key.json';
const CIRCUIT_VERSION = process.env.VERIFIER_CIRCUIT_VERSION ?? 'v1';
const START_TIME = Date.now();

// ─── Build the app (exported for tests) ──────────────────────────────

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '128kb' }));

  // POST /verify — the only mutating route. Synchronous; predictable
  // latency. No tenant auth — the verifier trusts its caller because
  // it's loopback-only. The caller (API repo) is responsible for tenant
  // scoping, audit-log writes in the platform tables, and replay defense.
  app.post('/verify', async (req: Request, res: Response) => {
    const t0 = Date.now();
    const body = req.body as Partial<VerifyRequest>;

    if (!body?.proof || !Array.isArray(body.publicSignals) || body.publicSignals.length !== 3) {
      res.status(400).json({ error: 'invalid_request', message: 'proof + publicSignals (length 3) are required' });
      return;
    }

    try {
      const { verified, structuralFallback } = await verifyProof(body.proof, body.publicSignals);
      const response: VerifyResponse = {
        verified,
        verifierAuditId: uuidv4(),
        latencyMs: Date.now() - t0,
        circuitVersion: body.circuitVersion ?? CIRCUIT_VERSION,
        structuralFallback,
      };
      logger.info('Verifier: verify result', {
        verified,
        structuralFallback,
        latencyMs: response.latencyMs,
        correlationId: body.correlationId,
        verifierAuditId: response.verifierAuditId,
      });
      res.json(response);
    } catch (err) {
      logger.error('Verifier: unexpected error', { error: (err as Error).message });
      res.status(500).json({ error: 'verifier_error' });
    }
  });

  // GET /health — for the API's liveness check + ops.
  app.get('/health', (_req: Request, res: Response) => {
    const response: HealthResponse = {
      status: isVkeyLoaded() ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      vkeyAvailable: isVkeyLoaded(),
      uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
    };
    res.json(response);
  });

  return app;
}

// ─── Standalone entrypoint ───────────────────────────────────────────

async function main() {
  await initVerifier(VKEY_PATH);
  const app = createApp();
  app.listen(PORT, BIND, () => {
    logger.info('Verifier: listening', { bind: BIND, port: PORT, circuitVersion: CIRCUIT_VERSION });
  });
}

// Run only when executed directly (not when imported by tests).
if (require.main === module) {
  main().catch((err) => {
    logger.error('Verifier: startup failed', { error: (err as Error).message });
    process.exit(1);
  });
}
