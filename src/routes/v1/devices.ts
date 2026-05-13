import { Router, Request, Response } from 'express';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import { createDevice, listDevices, updateDevice } from '../../services/platform';
import { DeviceStatus } from '../../types';

const router = Router();

const DEVICE_STATUSES: DeviceStatus[] = ['active', 'inactive', 'retired'];

router.post('/',
  authenticateTenantApiKey(['devices:write']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const { name, externalId, locationId, batteryLevel, metadata } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'invalid_request', message: 'name is required' });
        return;
      }

      if (batteryLevel !== undefined && (!Number.isInteger(batteryLevel) || batteryLevel < 0 || batteryLevel > 100)) {
        res.status(400).json({ error: 'invalid_request', message: 'batteryLevel must be an integer between 0 and 100' });
        return;
      }

      const device = await createDevice(
        tenant.id,
        apiKey.environment,
        { name, externalId, locationId, batteryLevel, metadata },
        { type: 'api_key', id: apiKey.id },
      );

      res.status(201).json({ device });
    } catch (err) {
      if ((err as Error).message.includes('duplicate key')) {
        res.status(409).json({ error: 'device_external_id_taken' });
        return;
      }
      res.status(500).json({ error: 'device_create_failed', message: (err as Error).message });
    }
  },
);

router.get('/',
  authenticateTenantApiKey(['devices:read']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const status = req.query.status as DeviceStatus | undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;

      if (status && !DEVICE_STATUSES.includes(status)) {
        res.status(400).json({ error: 'invalid_status_filter' });
        return;
      }

      const devices = await listDevices(tenant.id, apiKey.environment, { status, limit });
      res.json({ devices, environment: apiKey.environment });
    } catch (err) {
      res.status(500).json({ error: 'device_list_failed' });
    }
  },
);

router.patch('/:deviceId',
  authenticateTenantApiKey(['devices:write']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const { deviceId } = req.params;
      const { name, locationId, batteryLevel, status, metadata, lastSeenAt } = req.body;

      if (status && !DEVICE_STATUSES.includes(status)) {
        res.status(400).json({ error: 'invalid_status' });
        return;
      }
      if (batteryLevel !== undefined && (!Number.isInteger(batteryLevel) || batteryLevel < 0 || batteryLevel > 100)) {
        res.status(400).json({ error: 'invalid_battery_level' });
        return;
      }

      const device = await updateDevice(
        tenant.id,
        apiKey.environment,
        deviceId,
        { name, locationId, batteryLevel, status, metadata, lastSeenAt },
        { type: 'api_key', id: apiKey.id },
      );

      if (!device) {
        res.status(404).json({ error: 'device_not_found' });
        return;
      }

      res.json({ device });
    } catch (err) {
      res.status(500).json({ error: 'device_update_failed', message: (err as Error).message });
    }
  },
);

export default router;
