import express, { Request, Response } from 'express';
import { initVerifier, verifyProof, isVkeyLoaded } from './groth16';
import { logger } from './logger';
import { VerifyRequest, VerifyResponse, HealthResponse } from './types';
import { initAuditLog, appendEvent, getStats as auditStats, hashPayload, verifyChain } from './audit-log';

const PORT = parseInt(process.env.VERIFIER_PORT ?? '3001', 10);
const BIND = process.env.VERIFIER_BIND ?? '127.0.0.1';
const VKEY_PATH =
  process.env.VERIFIER_VKEY_PATH ?? 'circuits/build/verification_key.json';
const CIRCUIT_VERSION = process.env.VERIFIER_CIRCUIT_VERSION ?? 'v1';
const AUDIT_DB_PATH =
  process.env.VERIFIER_AUDIT_DB_PATH ?? 'verifier/data/audit.db';
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
    const t0Hr = process.hrtime.bigint();
    const t0 = Date.now();
    const body = req.body as Partial<VerifyRequest> & { tenantId?: string; environment?: string };

    if (!body?.proof || !Array.isArray(body.publicSignals) || body.publicSignals.length !== 3) {
      res.status(400).json({ error: 'invalid_request', message: 'proof + publicSignals (length 3) are required' });
      return;
    }

    try {
      const { verified, structuralFallback } = await verifyProof(body.proof, body.publicSignals);
      const latencyMs = Date.now() - t0;
      const latencyUs = Number((process.hrtime.bigint() - t0Hr) / 1000n);

      // Append to the verifier-local audit log (hash-chained, append-only).
      // Per security-policy §10 we hash the proof + signals rather than
      // storing them. The chain is verifyable later via /audit/verify.
      const verifierAuditId = appendEvent({
        tenantId: body.tenantId ?? 'unspecified',
        environment: (body.environment === 'test' ? 'test' : 'live'),
        circuitVersion: body.circuitVersion ?? CIRCUIT_VERSION,
        correlationId: body.correlationId ?? '',
        verified,
        structuralFallback,
        proofHash: hashPayload(body.proof),
        pubSignalsHash: hashPayload(body.publicSignals),
        latencyUs,
      });

      const response: VerifyResponse = {
        verified,
        verifierAuditId,
        latencyMs,
        circuitVersion: body.circuitVersion ?? CIRCUIT_VERSION,
        structuralFallback,
      };
      logger.info('Verifier: verify result', {
        verified,
        structuralFallback,
        latencyMs,
        correlationId: body.correlationId,
        verifierAuditId,
      });
      res.json(response);
    } catch (err) {
      logger.error('Verifier: unexpected error', { error: (err as Error).message });
      res.status(500).json({ error: 'verifier_error' });
    }
  });

  // Audit log introspection endpoints. Loopback-only — the verifier is
  // not internet-exposed and the API never proxies these. Useful for
  // ops + the evidence-pack assembler.
  app.get('/audit/stats', (_req: Request, res: Response) => {
    res.json(auditStats());
  });

  app.get('/audit/verify-chain', (_req: Request, res: Response) => {
    const result = verifyChain();
    res.status(result.ok ? 200 : 500).json(result);
  });

  // GET /health — for the API's liveness check + ops.
  app.get('/health', (_req: Request, res: Response) => {
    const a = auditStats();
    const response: HealthResponse = {
      status: isVkeyLoaded() ? 'ok' : 'degraded',
      version: process.env.npm_package_version ?? '0.1.0',
      vkeyAvailable: isVkeyLoaded(),
      uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
      audit: {
        rowCount: a.rowCount,
        nextSequence: a.nextSequence,
        lastEntryHashPrefix: a.lastEntryHashPrefix,
      },
    };
    res.json(response);
  });

  return app;
}

// ─── Standalone entrypoint ───────────────────────────────────────────

async function main() {
  await initVerifier(VKEY_PATH);
  initAuditLog(AUDIT_DB_PATH);
  const app = createApp();
  app.listen(PORT, BIND, () => {
    logger.info('Verifier: listening', {
      bind: BIND, port: PORT, circuitVersion: CIRCUIT_VERSION, auditDbPath: AUDIT_DB_PATH,
    });
  });
}

// Run only when executed directly (not when imported by tests).
if (require.main === module) {
  main().catch((err) => {
    logger.error('Verifier: startup failed', { error: (err as Error).message });
    process.exit(1);
  });
}
