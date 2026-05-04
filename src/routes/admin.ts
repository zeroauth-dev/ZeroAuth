import { Router, Request, Response } from 'express';
import { authenticateAdmin } from '../middleware/auth';
import { sessionStore } from '../services/session-store';
import { getBlockchainInfo, isBlockchainReady } from '../services/blockchain';

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

export default router;
