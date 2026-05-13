import { Router, Request, Response } from 'express';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import { createTenantUser, listTenantUsers, updateTenantUser } from '../../services/platform';
import { TenantUserStatus } from '../../types';

const router = Router();

const USER_STATUSES: TenantUserStatus[] = ['active', 'inactive'];

router.post('/',
  authenticateTenantApiKey(['users:write']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const { fullName, externalId, email, phone, employeeCode, primaryDeviceId, metadata } = req.body;

      if (!fullName || typeof fullName !== 'string' || fullName.trim().length === 0) {
        res.status(400).json({ error: 'invalid_request', message: 'fullName is required' });
        return;
      }

      const user = await createTenantUser(
        tenant.id,
        apiKey.environment,
        { fullName, externalId, email, phone, employeeCode, primaryDeviceId, metadata },
        { type: 'api_key', id: apiKey.id },
      );

      res.status(201).json({ user });
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('duplicate key')) {
        res.status(409).json({ error: 'user_external_id_taken' });
        return;
      }
      if (message.includes('Device not found')) {
        res.status(404).json({ error: 'device_not_found', message });
        return;
      }
      res.status(500).json({ error: 'user_create_failed', message });
    }
  },
);

router.get('/',
  authenticateTenantApiKey(['users:read']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const status = req.query.status as TenantUserStatus | undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;

      if (status && !USER_STATUSES.includes(status)) {
        res.status(400).json({ error: 'invalid_status_filter' });
        return;
      }

      const users = await listTenantUsers(tenant.id, apiKey.environment, { status, limit });
      res.json({ users, environment: apiKey.environment });
    } catch {
      res.status(500).json({ error: 'user_list_failed' });
    }
  },
);

router.patch('/:userId',
  authenticateTenantApiKey(['users:write']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const { userId } = req.params;
      const { fullName, email, phone, employeeCode, status, primaryDeviceId, metadata } = req.body;

      if (status && !USER_STATUSES.includes(status)) {
        res.status(400).json({ error: 'invalid_status' });
        return;
      }

      const user = await updateTenantUser(
        tenant.id,
        apiKey.environment,
        userId,
        { fullName, email, phone, employeeCode, status, primaryDeviceId, metadata },
        { type: 'api_key', id: apiKey.id },
      );

      if (!user) {
        res.status(404).json({ error: 'user_not_found' });
        return;
      }

      res.json({ user });
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('Device not found')) {
        res.status(404).json({ error: 'device_not_found', message });
        return;
      }
      res.status(500).json({ error: 'user_update_failed', message });
    }
  },
);

export default router;
