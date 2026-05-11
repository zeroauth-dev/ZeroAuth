import { Router, Request, Response } from 'express';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import { listAuditEvents } from '../../services/platform';
import { AuditStatus } from '../../types';

const router = Router();

const AUDIT_STATUSES: AuditStatus[] = ['success', 'failure'];

router.get('/',
  authenticateTenantApiKey(['audit:read']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const action = typeof req.query.action === 'string' ? req.query.action : undefined;
      const status = req.query.status as AuditStatus | undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;

      if (status && !AUDIT_STATUSES.includes(status)) {
        res.status(400).json({ error: 'invalid_status_filter' });
        return;
      }

      const events = await listAuditEvents(tenant.id, apiKey.environment, { action, status, limit });
      res.json({ events, environment: apiKey.environment });
    } catch {
      res.status(500).json({ error: 'audit_list_failed' });
    }
  },
);

export default router;
