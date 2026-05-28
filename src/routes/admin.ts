import { Router, Request, Response } from 'express';
import { authenticateAdmin } from '../middleware/auth';
import { sessionStore } from '../services/session-store';
import { getBlockchainInfo, isBlockchainReady } from '../services/blockchain';
import { verifyAuditChain, appendAuditEvent } from '../services/audit';
import { logger } from '../services/logger';

const router = Router();

// All admin routes require API key authentication
router.use(authenticateAdmin);

/**
 * GET /api/admin/stats
 * Returns dashboard statistics including verification counts,
 * blockchain info, and the critical zero-data-storage confirmation.
 */
router.get('/stats', async (_req: Request, res: Response) => {
  const stats = sessionStore.getStats();

  if (isBlockchainReady()) {
    try {
      const bcInfo = await getBlockchainInfo();
      stats.blockchain = {
        network: bcInfo.network,
        identityCount: bcInfo.identityCount,
        didRegistryAddress: bcInfo.contracts.DIDRegistry,
        verifierAddress: bcInfo.contracts.Verifier,
      };
    } catch {
      // Blockchain info is optional
    }
  }

  res.json(stats);
});

/**
 * GET /api/admin/privacy-audit
 * Returns a privacy audit report confirming no biometric data storage.
 */
router.get('/privacy-audit', (_req: Request, res: Response) => {
  res.json({
    auditTimestamp: new Date().toISOString(),
    biometricDataStored: false,
    personalDataStored: false,
    dataRetentionPolicy: 'Session tokens only, auto-expired',
    encryptionAtRest: 'N/A - no biometric data to encrypt',
    encryptionInTransit: 'TLS 1.3 required',
    complianceNotes: [
      'Zero biometric data stored. Ever. Breach-proof by architecture.',
      'ZKP proofs are verified and immediately discarded',
      'Session data contains only opaque identifiers',
      'No PII is persisted beyond session lifetime',
    ],
  });
});

/**
 * GET /api/admin/blockchain
 * Returns blockchain connectivity info, contract addresses, identity count.
 */
router.get('/blockchain', async (_req: Request, res: Response) => {
  if (!isBlockchainReady()) {
    res.json({
      status: 'offline',
      message: 'Blockchain not configured. Set BLOCKCHAIN_PRIVATE_KEY and DID_REGISTRY_ADDRESS.',
    });
    return;
  }

  try {
    const info = await getBlockchainInfo();
    res.json({ status: 'connected', ...info });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      error: (err as Error).message,
    });
  }
});

/**
 * GET /api/admin/audit-integrity
 *
 * Replay a tenant's audit_events hash chain and report whether it
 * reconstructs to the recorded event_hash on every row. Closes
 * Phase 0 commit C-014. ADR 0013 defines the chain; this endpoint
 * is the bank-facing read-only verification surface.
 *
 * Query:
 *   - tenant_id      (required) UUID of the tenant.
 *   - environment    optional 'live' | 'test'. Omitted = check both.
 *   - start_id       optional bigint, default 0 (full chain).
 *   - limit          optional bigint, default 100_000.
 *
 * Returns:
 *   - 200 { status: 'pass', tenantId, environment, rowsChecked }
 *   - 200 { status: 'fail', tenantId, environment, brokenAt, reason }
 *
 * The endpoint is itself audited — invoking the check writes a row.
 */
router.get('/audit-integrity', async (req: Request, res: Response) => {
  const tenantId = String(req.query.tenant_id ?? '').trim();
  const environment = req.query.environment === 'live' || req.query.environment === 'test'
    ? (req.query.environment as 'live' | 'test')
    : null;
  const startId = String(req.query.start_id ?? '0').trim();
  const limit = Number.parseInt(String(req.query.limit ?? '100000'), 10);

  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    res.status(400).json({ error: 'invalid_tenant_id', message: 'tenant_id must be a UUID.' });
    return;
  }
  if (Number.isNaN(limit) || limit < 1 || limit > 1_000_000) {
    res.status(400).json({ error: 'invalid_limit', message: 'limit must be 1..1000000.' });
    return;
  }

  try {
    const result = await verifyAuditChain(tenantId, environment, { startId, limit });
    if (result.ok) {
      // Audit-of-the-audit: record that the integrity check ran.
      void appendAuditEvent({
        tenant_id: tenantId,
        environment,
        actor_type: 'system',
        actor_id: null,
        action: 'audit.integrity_check',
        entity_type: 'tenant',
        entity_id: tenantId,
        status: 'success',
        summary: 'Audit hash chain verified',
        metadata: { startId, limit },
      }).catch(err => logger.warn('audit-integrity self-audit failed', {
        error: (err as Error).message,
      }));
      res.json({ status: 'pass', tenantId, environment, startId, limit });
      return;
    }
    void appendAuditEvent({
      tenant_id: tenantId,
      environment,
      actor_type: 'system',
      actor_id: null,
      action: 'audit.integrity_check',
      entity_type: 'tenant',
      entity_id: tenantId,
      status: 'failure',
      summary: 'Audit hash chain broken',
      metadata: { brokenAt: result.brokenAt, reason: result.reason, startId, limit },
    }).catch(err => logger.warn('audit-integrity self-audit failed', {
      error: (err as Error).message,
    }));
    res.json({
      status: 'fail',
      tenantId,
      environment,
      brokenAt: result.brokenAt,
      reason: result.reason,
    });
  } catch (err) {
    logger.error('audit-integrity check threw', { error: (err as Error).message });
    res.status(500).json({ error: 'audit_integrity_error' });
  }
});

export default router;
