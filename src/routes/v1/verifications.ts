import { Router, Request, Response } from 'express';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import { createVerificationEvent, listVerificationEvents } from '../../services/platform';
import { VerificationMethod, VerificationResult } from '../../types';

const router = Router();

const METHODS: VerificationMethod[] = ['zkp', 'fingerprint', 'face', 'depth', 'saml', 'oidc', 'manual'];
const RESULTS: VerificationResult[] = ['pass', 'fail', 'challenge'];

router.post('/',
  authenticateTenantApiKey(['verifications:write']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const { userId, deviceId, method, result, reason, confidenceScore, referenceId, metadata, occurredAt } = req.body;

      if (!method || !METHODS.includes(method)) {
        res.status(400).json({ error: 'invalid_method' });
        return;
      }
      if (!result || !RESULTS.includes(result)) {
        res.status(400).json({ error: 'invalid_result' });
        return;
      }

      const verification = await createVerificationEvent(tenant.id, apiKey.environment, apiKey.id, {
        userId,
        deviceId,
        method,
        result,
        reason,
        confidenceScore,
        referenceId,
        metadata,
        occurredAt,
      });

      res.status(201).json({ verification });
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('not found')) {
        res.status(404).json({ error: 'dependency_not_found', message });
        return;
      }
      res.status(500).json({ error: 'verification_create_failed', message });
    }
  },
);

router.get('/',
  authenticateTenantApiKey(['verifications:read']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const method = req.query.method as VerificationMethod | undefined;
      const result = req.query.result as VerificationResult | undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;

      if (method && !METHODS.includes(method)) {
        res.status(400).json({ error: 'invalid_method_filter' });
        return;
      }
      if (result && !RESULTS.includes(result)) {
        res.status(400).json({ error: 'invalid_result_filter' });
        return;
      }

      const verifications = await listVerificationEvents(tenant.id, apiKey.environment, { method, result, limit });
      res.json({ verifications, environment: apiKey.environment });
    } catch {
      res.status(500).json({ error: 'verification_list_failed' });
    }
  },
);

export default router;
