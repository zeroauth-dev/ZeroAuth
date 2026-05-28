import { Router, Request, Response } from 'express';
import { authenticateTenantApiKey, getTenantContext } from '../../middleware/tenant-auth';
import {
  claimDeviceWithCode,
  createDevice,
  EnrollmentClaimError,
  isValidDeviceType,
  listDevices,
  updateDevice,
} from '../../services/platform';
import { pgRateLimit } from '../../middleware/rate-limit';
import { DeviceStatus } from '../../types';

const router = Router();

const DEVICE_STATUSES: DeviceStatus[] = ['active', 'inactive', 'retired'];

// ADR 0022: device-side enrollment is unauthenticated (the code IS the
// credential) and is rate-limited per-IP to defeat code brute-forcing.
// 10 attempts per minute per IP is generous for legitimate enrolment
// (operator types the code wrong a few times) but blocks all practical
// online guessing against the 38-bit code space.
const enrollRateLimit = pgRateLimit({
  route: 'devices:enroll',
  windowMs: 60 * 1000,
  max: 10,
  keyBy: 'ip',
});

router.post('/',
  authenticateTenantApiKey(['devices:write']),
  async (req: Request, res: Response) => {
    try {
      const { tenant, apiKey } = getTenantContext(req);
      const { name, externalId, deviceType, locationId, batteryLevel, metadata } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'invalid_request', message: 'name is required' });
        return;
      }

      // device_type is optional on /v1/devices (legacy trusted-service
      // path stays compatible); when present it must be a valid value.
      if (deviceType !== undefined && !isValidDeviceType(deviceType)) {
        res.status(400).json({
          error: 'invalid_request',
          message: "device_type must be one of: 'mobile_android' | 'mobile_ios' | 'kiosk' | 'iot_bridge' | 'desktop'",
        });
        return;
      }

      if (batteryLevel !== undefined && (!Number.isInteger(batteryLevel) || batteryLevel < 0 || batteryLevel > 100)) {
        res.status(400).json({ error: 'invalid_request', message: 'batteryLevel must be an integer between 0 and 100' });
        return;
      }

      const device = await createDevice(
        tenant.id,
        apiKey.environment,
        { name, externalId, deviceType, locationId, batteryLevel, metadata },
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

/**
 * ADR 0022 device-side enrollment.
 *
 * This is the ONE tenant-API endpoint that doesn't require a tenant
 * API key — the enrollment code itself is the bearer credential.
 * Authority is established by:
 *   - The code's SHA-256 matching a pending device row (server-side).
 *   - The code being inside its 15-minute TTL window.
 *   - The per-IP rate-limit defeating online code guessing.
 *
 * On success the row flips to `enrolled`, its `fingerprint_hash` is
 * bound, and we return the device row. A `device_token` (for future
 * heartbeats) lands in Phase 1 Sprint 4 — V1 returns the row only and
 * the device infers its identity from `device.id` + `external_id`.
 *
 * All failure modes (unknown code, expired code, invalid fingerprint,
 * fingerprint collision with another active device) return a uniform
 * 404 `enrollment_failed` so we don't leak which condition failed.
 * The audit row records the actual cause for forensic review.
 */
router.post('/enroll', enrollRateLimit, async (req: Request, res: Response) => {
  try {
    const { enrollment_code, fingerprint, attestation_kind } = req.body ?? {};
    if (typeof enrollment_code !== 'string' || enrollment_code.length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'enrollment_code is required' });
      return;
    }
    if (typeof fingerprint !== 'string' || fingerprint.length === 0) {
      res.status(400).json({ error: 'invalid_request', message: 'fingerprint is required' });
      return;
    }
    if (attestation_kind !== undefined && typeof attestation_kind !== 'string') {
      res.status(400).json({ error: 'invalid_request', message: 'attestation_kind must be a string' });
      return;
    }

    const device = await claimDeviceWithCode({
      enrollmentCode: enrollment_code,
      fingerprint,
      attestationKind: attestation_kind,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    res.status(200).json({ device });
  } catch (err) {
    if (err instanceof EnrollmentClaimError) {
      // Uniform error envelope across all enrollment failure modes —
      // do not leak which condition failed to the device. The audit
      // log row captures the actual reason for forensic review.
      res.status(404).json({ error: 'enrollment_failed' });
      return;
    }
    res.status(500).json({ error: 'device_enroll_failed', message: (err as Error).message });
  }
});

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
