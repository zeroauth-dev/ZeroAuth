import { Router, Request, Response } from 'express';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import { createAttendanceEvent, listAttendanceEvents } from '../../services/platform';
import { AttendanceEventType, AttendanceResult } from '../../types';

const router = Router();

const ATTENDANCE_TYPES: AttendanceEventType[] = ['check_in', 'check_out'];
const ATTENDANCE_RESULTS: AttendanceResult[] = ['accepted', 'rejected'];

router.post('/',
  authenticateTenantApiKey(['attendance:write']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const { userId, deviceId, verificationId, type, result, metadata, occurredAt } = req.body;

      if (!userId || typeof userId !== 'string') {
        res.status(400).json({ error: 'invalid_request', message: 'userId is required' });
        return;
      }
      if (!type || !ATTENDANCE_TYPES.includes(type)) {
        res.status(400).json({ error: 'invalid_type' });
        return;
      }
      if (result && !ATTENDANCE_RESULTS.includes(result)) {
        res.status(400).json({ error: 'invalid_result' });
        return;
      }

      const attendance = await createAttendanceEvent(tenant.id, apiKey.environment, apiKey.id, {
        userId,
        deviceId,
        verificationId,
        type,
        result,
        metadata,
        occurredAt,
      });

      res.status(201).json({ attendance });
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes('not found')) {
        res.status(404).json({ error: 'dependency_not_found', message });
        return;
      }
      res.status(500).json({ error: 'attendance_create_failed', message });
    }
  },
);

router.get('/',
  authenticateTenantApiKey(['attendance:read']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const type = req.query.type as AttendanceEventType | undefined;
      const result = req.query.result as AttendanceResult | undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;

      if (type && !ATTENDANCE_TYPES.includes(type)) {
        res.status(400).json({ error: 'invalid_type_filter' });
        return;
      }
      if (result && !ATTENDANCE_RESULTS.includes(result)) {
        res.status(400).json({ error: 'invalid_result_filter' });
        return;
      }

      const attendance = await listAttendanceEvents(tenant.id, apiKey.environment, { type, result, limit });
      res.json({ attendance, environment: apiKey.environment });
    } catch {
      res.status(500).json({ error: 'attendance_list_failed' });
    }
  },
);

export default router;
