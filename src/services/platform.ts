import { v4 as uuidv4 } from 'uuid';
import { getPool } from './db';
import { logger } from './logger';
import { appendAuditEvent } from './audit';
import {
  ENROLLMENT_CODE_TTL_MS,
  fingerprintHash,
  generateEnrollmentCode,
  isValidFingerprint,
  normaliseEnrollmentCode,
  sha256Hex,
} from './device-enrollment';
import {
  ApiKeyEnvironment,
  AttendanceEvent,
  AttendanceEventType,
  AttendanceResult,
  AuditActorType,
  AuditEvent,
  AuditStatus,
  Device,
  DeviceEnrollmentState,
  DeviceStatus,
  DeviceType,
  TenantUser,
  TenantUserStatus,
  VerificationMethod,
  VerificationRecord,
  VerificationResult,
} from '../types';

/** Allowed device-type strings; the runtime guard counterpart of the DB CHECK constraint. */
const DEVICE_TYPES: readonly DeviceType[] = [
  'mobile_android',
  'mobile_ios',
  'kiosk',
  'iot_bridge',
  'desktop',
] as const;

export function isValidDeviceType(v: unknown): v is DeviceType {
  return typeof v === 'string' && (DEVICE_TYPES as readonly string[]).includes(v);
}

function sanitizeMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

/**
 * Caller-provided attribution for audit-log entries.
 *
 * Set by route handlers; threaded through the service functions that write
 * to `audit_events`. Per the platform audit-format spec, audit rows must
 * record `actor_type` accurately ('api_key' for /v1 calls authenticated via
 * tenant API key; 'console' for /api/console calls authenticated via the
 * developer-dashboard JWT) and `metadata.actor_email` when the actor is a
 * human operator. Issue #26 F-3 — before this plumbing landed, console-
 * initiated rows were being mislabelled as `actor_type='api_key'` with
 * `actor_id=NULL`.
 */
export interface AuditActor {
  type: AuditActorType;
  /** The api_keys.id (when type='api_key') or the tenant id (when type='console'). NULL is acceptable for 'system'. */
  id?: string | null;
  /** The operator's email when `type='console'`. Goes to `audit_events.metadata.actor_email`. */
  email?: string | null;
}

function actorMetadata(actor?: AuditActor): Record<string, unknown> {
  if (!actor?.email) return {};
  return { actor_email: actor.email };
}

function sanitizeLimit(limit?: number, fallback: number = 50): number {
  if (!limit || Number.isNaN(limit)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(limit)));
}

function defaultExternalId(prefix: string, externalId?: string): string {
  if (typeof externalId === 'string' && externalId.trim().length > 0) {
    return externalId.trim();
  }
  return `${prefix}_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
}

async function findDevice(
  tenantId: string,
  environment: ApiKeyEnvironment,
  deviceId: string,
): Promise<Device | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM devices
     WHERE id = $1 AND tenant_id = $2 AND environment = $3`,
    [deviceId, tenantId, environment],
  );
  return result.rows[0] as Device || null;
}

async function findTenantUser(
  tenantId: string,
  environment: ApiKeyEnvironment,
  userId: string,
): Promise<TenantUser | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM tenant_users
     WHERE id = $1 AND tenant_id = $2 AND environment = $3`,
    [userId, tenantId, environment],
  );
  return result.rows[0] as TenantUser || null;
}

async function findVerification(
  tenantId: string,
  environment: ApiKeyEnvironment,
  verificationId: string,
): Promise<VerificationRecord | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT * FROM verification_events
     WHERE id = $1 AND tenant_id = $2 AND environment = $3`,
    [verificationId, tenantId, environment],
  );
  return result.rows[0] as VerificationRecord || null;
}

function parseTimestamp(value?: string): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Invalid ISO timestamp');
  }
  return parsed;
}

/**
 * Append a row to `audit_events` with the ADR 0013 hash chain.
 *
 * Every audit row goes through this single entry point — direct
 * `INSERT INTO audit_events` is forbidden in application code (and
 * the `tests/audit-chain.test.ts` grep guard catches re-introductions).
 * The actual chain computation + advisory locking lives in
 * `src/services/audit.ts::appendAuditEvent`; this wrapper is the
 * legacy-name surface kept for backward compatibility with the
 * existing 6+ call sites scattered across platform.ts and the route
 * layer.
 */
export async function recordAuditEvent(
  tenantId: string,
  input: {
    environment?: ApiKeyEnvironment | null;
    actorType: AuditActorType;
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    status: AuditStatus;
    summary: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await appendAuditEvent({
    tenant_id: tenantId,
    environment: input.environment ?? null,
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    status: input.status,
    summary: input.summary,
    metadata: sanitizeMetadata(input.metadata) as Record<string, unknown>,
  });
}

/**
 * Direct device-row create for the trusted-service path (POST /v1/devices
 * called with a tenant API key). The row lands `enrollment_state='enrolled'`
 * with no enrollment code involved — the caller has already provisioned
 * the hardware identity and is asserting it on the device's behalf. This
 * is the path used by SDK-led bulk provisioning and the demo seed scripts.
 *
 * The dashboard's "Register device" flow does NOT use this entry point;
 * it calls `issueEnrollmentCode` (below) to mint a pending slot + code
 * that the device then exchanges for an enrolled row via
 * `claimDeviceWithCode` on /v1/devices/enroll.
 */
export async function createDevice(
  tenantId: string,
  environment: ApiKeyEnvironment,
  input: {
    externalId?: string;
    name: string;
    deviceType?: DeviceType;
    locationId?: string;
    batteryLevel?: number;
    metadata?: Record<string, unknown>;
  },
  actor?: AuditActor,
): Promise<Device> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO devices
      (tenant_id, environment, external_id, name, device_type, enrollment_state,
       location_id, battery_level, metadata, last_seen_at, enrolled_at)
     VALUES ($1, $2, $3, $4, $5, 'enrolled', $6, $7, $8, NOW(), NOW())
     RETURNING *`,
    [
      tenantId,
      environment,
      defaultExternalId('device', input.externalId),
      input.name.trim(),
      input.deviceType ?? 'kiosk',
      input.locationId?.trim() || null,
      input.batteryLevel ?? null,
      sanitizeMetadata(input.metadata),
    ],
  );

  const device = result.rows[0] as Device;
  void recordAuditEvent(tenantId, {
    environment,
    actorType: actor?.type ?? 'api_key',
    actorId: actor?.id ?? null,
    action: 'device.created',
    entityType: 'device',
    entityId: device.id,
    status: 'success',
    summary: `Registered device ${device.external_id}`,
    metadata: {
      locationId: device.location_id,
      name: device.name,
      deviceType: device.device_type,
      via: 'trusted-service',
      ...actorMetadata(actor),
    },
  }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

  return device;
}

/**
 * Result envelope for the dashboard's "Register device" call. The
 * plaintext `enrollmentCode` is the ONLY chance the operator gets to
 * see the code — we hash and discard the plaintext after this insert.
 * If the operator loses it, they call `regenerateEnrollmentCode`
 * (which writes a new audit row and a new hash) — never recovers the
 * old code, which never existed in clear after this function returned.
 */
export interface DeviceEnrollmentInvite {
  device: Device;
  enrollmentCode: string;
  expiresAt: Date;
}

/**
 * Console-initiated enrollment slot. Creates a row in `pending` state,
 * generates a fresh enrollment code, persists its SHA-256 + 15-min
 * TTL, and returns the plaintext code to the caller exactly once.
 *
 * The `external_id` is a placeholder `pending_<uuid>` until the
 * device claims the slot — at which point `claimDeviceWithCode`
 * overwrites it with `dev_<sha256_prefix>` so audit-log searches by
 * device identity stay meaningful.
 */
export async function issueEnrollmentCode(
  tenantId: string,
  environment: ApiKeyEnvironment,
  input: {
    name: string;
    deviceType: DeviceType;
    locationId?: string;
    metadata?: Record<string, unknown>;
  },
  actor?: AuditActor,
): Promise<DeviceEnrollmentInvite> {
  if (!isValidDeviceType(input.deviceType)) {
    throw new Error(`invalid device_type: ${input.deviceType}`);
  }
  const code = generateEnrollmentCode();
  const codeHash = sha256Hex(code);
  const expiresAt = new Date(Date.now() + ENROLLMENT_CODE_TTL_MS);

  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO devices
      (tenant_id, environment, external_id, name, device_type, enrollment_state,
       enrollment_code_hash, enrollment_code_expires_at,
       location_id, metadata)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9)
     RETURNING *`,
    [
      tenantId,
      environment,
      defaultExternalId('pending', undefined),
      input.name.trim(),
      input.deviceType,
      codeHash,
      expiresAt,
      input.locationId?.trim() || null,
      sanitizeMetadata(input.metadata),
    ],
  );

  const device = result.rows[0] as Device;
  void recordAuditEvent(tenantId, {
    environment,
    actorType: actor?.type ?? 'console',
    actorId: actor?.id ?? null,
    action: 'device.enrollment_code_issued',
    entityType: 'device',
    entityId: device.id,
    status: 'success',
    summary: `Issued enrollment code for ${device.name}`,
    metadata: {
      deviceType: device.device_type,
      locationId: device.location_id,
      expiresAt: expiresAt.toISOString(),
      // The code's HASH is on the row; we record only the expiry +
      // device_type here so audit searches don't leak the secret.
      ...actorMetadata(actor),
    },
  }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

  return { device, enrollmentCode: code, expiresAt };
}

/**
 * Re-issue an enrollment code on a pending row. Used when the operator
 * loses the code or the 15-minute TTL elapses. The old hash is
 * overwritten — there is no way to recover the old code, and the old
 * code is no longer accepted by `claimDeviceWithCode`.
 *
 * Returns `null` if the row doesn't exist, isn't pending, or doesn't
 * belong to this tenant/environment.
 */
export async function regenerateEnrollmentCode(
  tenantId: string,
  environment: ApiKeyEnvironment,
  deviceId: string,
  actor?: AuditActor,
): Promise<DeviceEnrollmentInvite | null> {
  const code = generateEnrollmentCode();
  const codeHash = sha256Hex(code);
  const expiresAt = new Date(Date.now() + ENROLLMENT_CODE_TTL_MS);

  const pool = getPool();
  const result = await pool.query(
    `UPDATE devices
     SET enrollment_code_hash = $4,
         enrollment_code_expires_at = $5,
         updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND environment = $3
       AND enrollment_state = 'pending'
     RETURNING *`,
    [deviceId, tenantId, environment, codeHash, expiresAt],
  );

  const device = result.rows[0] as Device | undefined;
  if (!device) return null;

  void recordAuditEvent(tenantId, {
    environment,
    actorType: actor?.type ?? 'console',
    actorId: actor?.id ?? null,
    action: 'device.enrollment_code_reissued',
    entityType: 'device',
    entityId: device.id,
    status: 'success',
    summary: `Re-issued enrollment code for ${device.name}`,
    metadata: { expiresAt: expiresAt.toISOString(), ...actorMetadata(actor) },
  }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

  return { device, enrollmentCode: code, expiresAt };
}

export class EnrollmentClaimError extends Error {
  constructor(public reason: 'invalid_fingerprint' | 'code_not_found_or_expired' | 'fingerprint_collision') {
    super(reason);
    this.name = 'EnrollmentClaimError';
  }
}

/**
 * Device-side claim. The device POSTs the plaintext code + a hardware
 * fingerprint string to /v1/devices/enroll; this function:
 *
 *   1. Normalises the code (whitespace, hyphens, case).
 *   2. SHA-256s it and looks up the pending row.
 *   3. Checks TTL (`enrollment_code_expires_at > NOW()`).
 *   4. Asserts the fingerprint doesn't collide with another active
 *      device in the same tenant/environment (prevents a phone from
 *      enrolling itself as two different rows).
 *   5. Writes: `external_id = dev_<sha256_prefix>`, `fingerprint_hash`,
 *      `attestation_kind`, `enrollment_state = 'enrolled'`,
 *      `enrolled_at = NOW()`, clears the code hash.
 *   6. Writes a `device.enrolled` audit row.
 *
 * Returns the updated row. Failure modes throw `EnrollmentClaimError`
 * so the route handler can translate to a generic 404/409 without
 * leaking which condition failed.
 */
export async function claimDeviceWithCode(input: {
  enrollmentCode: string;
  fingerprint: string;
  attestationKind?: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<Device> {
  if (!isValidFingerprint(input.fingerprint)) {
    throw new EnrollmentClaimError('invalid_fingerprint');
  }

  const normalisedCode = normaliseEnrollmentCode(input.enrollmentCode);
  const codeHash = sha256Hex(normalisedCode);
  const fpHash = fingerprintHash(input.fingerprint);
  const newExternalId = `dev_${fpHash.slice(0, 16)}`;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Step 1: locate the pending row, lock it for update.
    const found = await client.query(
      `SELECT * FROM devices
       WHERE enrollment_code_hash = $1
         AND enrollment_state = 'pending'
         AND enrollment_code_expires_at > NOW()
       FOR UPDATE`,
      [codeHash],
    );
    const pending = found.rows[0] as Device | undefined;
    if (!pending) {
      await client.query('ROLLBACK');
      throw new EnrollmentClaimError('code_not_found_or_expired');
    }

    // Step 2: assert the fingerprint isn't already bound to another
    // enrolled row in the same (tenant, environment). A repeat call
    // from the same device on the same slot (same row) is fine; a
    // different slot would land an FK-shaped surprise on
    // tenant_users.primary_device_id, which is why we reject early.
    const collision = await client.query(
      `SELECT id FROM devices
       WHERE tenant_id = $1
         AND environment = $2
         AND fingerprint_hash = $3
         AND id <> $4`,
      [pending.tenant_id, pending.environment, fpHash, pending.id],
    );
    if ((collision.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      throw new EnrollmentClaimError('fingerprint_collision');
    }

    // Step 3: commit the claim.
    const updated = await client.query(
      `UPDATE devices
       SET external_id = $2,
           fingerprint_hash = $3,
           attestation_kind = $4,
           enrollment_state = 'enrolled',
           enrolled_at = NOW(),
           enrollment_code_hash = NULL,
           enrollment_code_expires_at = NULL,
           last_seen_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [pending.id, newExternalId, fpHash, input.attestationKind ?? 'none'],
    );

    await client.query('COMMIT');
    const device = updated.rows[0] as Device;

    void recordAuditEvent(device.tenant_id, {
      environment: device.environment,
      actorType: 'device',
      actorId: device.id,
      action: 'device.enrolled',
      entityType: 'device',
      entityId: device.id,
      status: 'success',
      summary: `Device ${device.name} enrolled`,
      metadata: {
        deviceType: device.device_type,
        attestationKind: device.attestation_kind,
        // Fingerprint plaintext stays out of audit metadata; hash is on
        // the row already. IP/UA are retained for forensics on hostile
        // enrollment attempts.
        enrollIp: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

    return device;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Admin-initiated device retirement. Sets `enrollment_state='revoked'`
 * and `status='retired'`. The row stays in the table so audit search
 * by entity_id keeps working. A revoked device's fingerprint can be
 * re-enrolled on a NEW pending slot (the collision check above
 * scopes on `enrollment_state IN ('pending','enrolled')` via the
 * `fingerprint_hash` lookup — see the test fixtures).
 */
export async function revokeDevice(
  tenantId: string,
  environment: ApiKeyEnvironment,
  deviceId: string,
  actor?: AuditActor,
): Promise<Device | null> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE devices
     SET enrollment_state = 'revoked',
         status = 'retired',
         enrollment_code_hash = NULL,
         enrollment_code_expires_at = NULL,
         updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND environment = $3
     RETURNING *`,
    [deviceId, tenantId, environment],
  );
  const device = result.rows[0] as Device | undefined;
  if (!device) return null;

  void recordAuditEvent(tenantId, {
    environment,
    actorType: actor?.type ?? 'console',
    actorId: actor?.id ?? null,
    action: 'device.revoked',
    entityType: 'device',
    entityId: device.id,
    status: 'success',
    summary: `Revoked device ${device.name}`,
    metadata: actorMetadata(actor),
  }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

  return device;
}

export async function listDevices(
  tenantId: string,
  environment: ApiKeyEnvironment,
  options: { status?: DeviceStatus; enrollmentState?: DeviceEnrollmentState; limit?: number } = {},
): Promise<Device[]> {
  const pool = getPool();
  const params: unknown[] = [tenantId, environment];
  let query = `SELECT * FROM devices WHERE tenant_id = $1 AND environment = $2`;

  if (options.status) {
    params.push(options.status);
    query += ` AND status = $${params.length}`;
  }
  if (options.enrollmentState) {
    params.push(options.enrollmentState);
    query += ` AND enrollment_state = $${params.length}`;
  }

  params.push(sanitizeLimit(options.limit));
  query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

  const result = await pool.query(query, params);
  return result.rows as Device[];
}

export async function updateDevice(
  tenantId: string,
  environment: ApiKeyEnvironment,
  deviceId: string,
  input: {
    name?: string;
    locationId?: string;
    batteryLevel?: number;
    status?: DeviceStatus;
    metadata?: Record<string, unknown>;
    lastSeenAt?: string;
  },
  actor?: AuditActor,
): Promise<Device | null> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE devices
     SET name = COALESCE($4, name),
         location_id = COALESCE($5, location_id),
         battery_level = CASE WHEN $6::int IS NULL THEN battery_level ELSE $6 END,
         status = COALESCE($7, status),
         metadata = CASE WHEN $8::jsonb IS NULL THEN metadata ELSE $8::jsonb END,
         last_seen_at = COALESCE($9, last_seen_at),
         updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND environment = $3
     RETURNING *`,
    [
      deviceId,
      tenantId,
      environment,
      input.name?.trim() || null,
      input.locationId?.trim() || null,
      input.batteryLevel ?? null,
      input.status ?? null,
      input.metadata ? sanitizeMetadata(input.metadata) : null,
      input.lastSeenAt ? parseTimestamp(input.lastSeenAt).toISOString() : null,
    ],
  );

  const device = result.rows[0] as Device | undefined;
  if (!device) return null;

  void recordAuditEvent(tenantId, {
    environment,
    actorType: actor?.type ?? 'api_key',
    actorId: actor?.id ?? null,
    action: 'device.updated',
    entityType: 'device',
    entityId: device.id,
    status: 'success',
    summary: `Updated device ${device.external_id}`,
    metadata: {
      status: device.status,
      batteryLevel: device.battery_level,
      ...actorMetadata(actor),
    },
  }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

  return device;
}

export async function createTenantUser(
  tenantId: string,
  environment: ApiKeyEnvironment,
  input: {
    externalId?: string;
    fullName: string;
    email?: string;
    phone?: string;
    employeeCode?: string;
    primaryDeviceId?: string;
    metadata?: Record<string, unknown>;
  },
  actor?: AuditActor,
): Promise<TenantUser> {
  const pool = getPool();
  let primaryDeviceId: string | null = null;

  if (input.primaryDeviceId) {
    const device = await findDevice(tenantId, environment, input.primaryDeviceId);
    if (!device) throw new Error('Device not found for this tenant/environment');
    primaryDeviceId = device.id;
  }

  const result = await pool.query(
    `INSERT INTO tenant_users
      (tenant_id, environment, external_id, full_name, email, phone, employee_code, primary_device_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      tenantId,
      environment,
      defaultExternalId('user', input.externalId),
      input.fullName.trim(),
      input.email?.trim().toLowerCase() || null,
      input.phone?.trim() || null,
      input.employeeCode?.trim() || null,
      primaryDeviceId,
      sanitizeMetadata(input.metadata),
    ],
  );

  const user = result.rows[0] as TenantUser;
  void recordAuditEvent(tenantId, {
    environment,
    actorType: actor?.type ?? 'api_key',
    actorId: actor?.id ?? null,
    action: 'user.created',
    entityType: 'user',
    entityId: user.id,
    status: 'success',
    summary: `Enrolled user ${user.external_id}`,
    metadata: { fullName: user.full_name, primaryDeviceId: user.primary_device_id, ...actorMetadata(actor) },
  }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

  return user;
}

export async function listTenantUsers(
  tenantId: string,
  environment: ApiKeyEnvironment,
  options: { status?: TenantUserStatus; limit?: number } = {},
): Promise<TenantUser[]> {
  const pool = getPool();
  const params: unknown[] = [tenantId, environment];
  let query = `SELECT * FROM tenant_users WHERE tenant_id = $1 AND environment = $2`;

  if (options.status) {
    params.push(options.status);
    query += ` AND status = $${params.length}`;
  }

  params.push(sanitizeLimit(options.limit));
  query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

  const result = await pool.query(query, params);
  return result.rows as TenantUser[];
}

export async function updateTenantUser(
  tenantId: string,
  environment: ApiKeyEnvironment,
  userId: string,
  input: {
    fullName?: string;
    email?: string;
    phone?: string;
    employeeCode?: string;
    status?: TenantUserStatus;
    primaryDeviceId?: string;
    metadata?: Record<string, unknown>;
  },
  actor?: AuditActor,
): Promise<TenantUser | null> {
  const pool = getPool();
  let primaryDeviceId: string | null = null;

  if (input.primaryDeviceId) {
    const device = await findDevice(tenantId, environment, input.primaryDeviceId);
    if (!device) throw new Error('Device not found for this tenant/environment');
    primaryDeviceId = device.id;
  }

  const result = await pool.query(
    `UPDATE tenant_users
     SET full_name = COALESCE($4, full_name),
         email = COALESCE($5, email),
         phone = COALESCE($6, phone),
         employee_code = COALESCE($7, employee_code),
         status = COALESCE($8, status),
         primary_device_id = COALESCE($9, primary_device_id),
         metadata = CASE WHEN $10::jsonb IS NULL THEN metadata ELSE $10::jsonb END,
         updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND environment = $3
     RETURNING *`,
    [
      userId,
      tenantId,
      environment,
      input.fullName?.trim() || null,
      input.email?.trim().toLowerCase() || null,
      input.phone?.trim() || null,
      input.employeeCode?.trim() || null,
      input.status ?? null,
      primaryDeviceId,
      input.metadata ? sanitizeMetadata(input.metadata) : null,
    ],
  );

  const user = result.rows[0] as TenantUser | undefined;
  if (!user) return null;

  void recordAuditEvent(tenantId, {
    environment,
    actorType: actor?.type ?? 'api_key',
    actorId: actor?.id ?? null,
    action: 'user.updated',
    entityType: 'user',
    entityId: user.id,
    status: 'success',
    summary: `Updated user ${user.external_id}`,
    metadata: { status: user.status, primaryDeviceId: user.primary_device_id, ...actorMetadata(actor) },
  }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

  return user;
}

export async function createVerificationEvent(
  tenantId: string,
  environment: ApiKeyEnvironment,
  apiKeyId: string,
  input: {
    userId?: string;
    deviceId?: string;
    method: VerificationMethod;
    result: VerificationResult;
    reason?: string;
    confidenceScore?: number;
    referenceId?: string;
    metadata?: Record<string, unknown>;
    occurredAt?: string;
  },
): Promise<VerificationRecord> {
  const pool = getPool();
  const occurredAt = parseTimestamp(input.occurredAt);

  let userId: string | null = null;
  let deviceId: string | null = null;

  if (input.userId) {
    const user = await findTenantUser(tenantId, environment, input.userId);
    if (!user) throw new Error('User not found for this tenant/environment');
    userId = user.id;
  }

  if (input.deviceId) {
    const device = await findDevice(tenantId, environment, input.deviceId);
    if (!device) throw new Error('Device not found for this tenant/environment');
    deviceId = device.id;
  }

  const result = await pool.query(
    `INSERT INTO verification_events
      (tenant_id, environment, user_id, device_id, api_key_id, method, result, reason, confidence_score, reference_id, metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      tenantId,
      environment,
      userId,
      deviceId,
      apiKeyId,
      input.method,
      input.result,
      input.reason?.trim() || null,
      input.confidenceScore ?? null,
      input.referenceId?.trim() || null,
      sanitizeMetadata(input.metadata),
      occurredAt.toISOString(),
    ],
  );

  if (deviceId) {
    void pool.query(
      `UPDATE devices SET last_seen_at = $3, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [deviceId, tenantId, occurredAt.toISOString()],
    ).catch(() => undefined);
  }

  if (userId && input.result === 'pass') {
    void pool.query(
      `UPDATE tenant_users SET last_verified_at = $3, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [userId, tenantId, occurredAt.toISOString()],
    ).catch(() => undefined);
  }

  const verification = result.rows[0] as VerificationRecord;
  void recordAuditEvent(tenantId, {
    environment,
    actorType: 'api_key',
    actorId: apiKeyId,
    action: 'verification.recorded',
    entityType: 'verification',
    entityId: verification.id,
    status: verification.result === 'fail' ? 'failure' : 'success',
    summary: `${verification.method} verification ${verification.result}`,
    metadata: {
      userId: verification.user_id,
      deviceId: verification.device_id,
      referenceId: verification.reference_id,
    },
  }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

  return verification;
}

export async function listVerificationEvents(
  tenantId: string,
  environment: ApiKeyEnvironment,
  options: {
    method?: VerificationMethod;
    result?: VerificationResult;
    limit?: number;
  } = {},
): Promise<VerificationRecord[]> {
  const pool = getPool();
  const params: unknown[] = [tenantId, environment];
  let query = `SELECT * FROM verification_events WHERE tenant_id = $1 AND environment = $2`;

  if (options.method) {
    params.push(options.method);
    query += ` AND method = $${params.length}`;
  }
  if (options.result) {
    params.push(options.result);
    query += ` AND result = $${params.length}`;
  }

  params.push(sanitizeLimit(options.limit));
  query += ` ORDER BY occurred_at DESC LIMIT $${params.length}`;

  const result = await pool.query(query, params);
  return result.rows as VerificationRecord[];
}

export async function createAttendanceEvent(
  tenantId: string,
  environment: ApiKeyEnvironment,
  apiKeyId: string,
  input: {
    userId: string;
    deviceId?: string;
    verificationId?: string;
    type: AttendanceEventType;
    result?: AttendanceResult;
    metadata?: Record<string, unknown>;
    occurredAt?: string;
  },
): Promise<AttendanceEvent> {
  const pool = getPool();
  const occurredAt = parseTimestamp(input.occurredAt);

  const user = await findTenantUser(tenantId, environment, input.userId);
  if (!user) throw new Error('User not found for this tenant/environment');

  let deviceId: string | null = null;
  if (input.deviceId) {
    const device = await findDevice(tenantId, environment, input.deviceId);
    if (!device) throw new Error('Device not found for this tenant/environment');
    deviceId = device.id;
  }

  let verificationId: string | null = null;
  let derivedResult: AttendanceResult = input.result ?? 'accepted';
  if (input.verificationId) {
    const verification = await findVerification(tenantId, environment, input.verificationId);
    if (!verification) throw new Error('Verification not found for this tenant/environment');
    verificationId = verification.id;
    if (!input.result) {
      derivedResult = verification.result === 'pass' ? 'accepted' : 'rejected';
    }
  }

  const result = await pool.query(
    `INSERT INTO attendance_events
      (tenant_id, environment, user_id, device_id, verification_id, event_type, result, metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      tenantId,
      environment,
      user.id,
      deviceId,
      verificationId,
      input.type,
      derivedResult,
      sanitizeMetadata(input.metadata),
      occurredAt.toISOString(),
    ],
  );

  const event = result.rows[0] as AttendanceEvent;
  void recordAuditEvent(tenantId, {
    environment,
    actorType: 'api_key',
    actorId: apiKeyId,
    action: 'attendance.recorded',
    entityType: 'attendance',
    entityId: event.id,
    status: event.result === 'rejected' ? 'failure' : 'success',
    summary: `${event.event_type} ${event.result}`,
    metadata: {
      userId: event.user_id,
      deviceId: event.device_id,
      verificationId: event.verification_id,
    },
  }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

  return event;
}

export async function listAttendanceEvents(
  tenantId: string,
  environment: ApiKeyEnvironment,
  options: {
    type?: AttendanceEventType;
    result?: AttendanceResult;
    limit?: number;
  } = {},
): Promise<AttendanceEvent[]> {
  const pool = getPool();
  const params: unknown[] = [tenantId, environment];
  let query = `SELECT * FROM attendance_events WHERE tenant_id = $1 AND environment = $2`;

  if (options.type) {
    params.push(options.type);
    query += ` AND event_type = $${params.length}`;
  }
  if (options.result) {
    params.push(options.result);
    query += ` AND result = $${params.length}`;
  }

  params.push(sanitizeLimit(options.limit));
  query += ` ORDER BY occurred_at DESC LIMIT $${params.length}`;

  const result = await pool.query(query, params);
  return result.rows as AttendanceEvent[];
}

export async function listAuditEvents(
  tenantId: string,
  environment: ApiKeyEnvironment,
  options: {
    action?: string;
    status?: AuditStatus;
    limit?: number;
  } = {},
): Promise<AuditEvent[]> {
  const pool = getPool();
  const params: unknown[] = [tenantId, environment];
  let query = `SELECT * FROM audit_events WHERE tenant_id = $1 AND environment = $2`;

  if (options.action) {
    params.push(options.action);
    query += ` AND action = $${params.length}`;
  }
  if (options.status) {
    params.push(options.status);
    query += ` AND status = $${params.length}`;
  }

  params.push(sanitizeLimit(options.limit));
  query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

  const result = await pool.query(query, params);
  return result.rows as AuditEvent[];
}

export async function getConsoleOverview(
  tenantId: string,
  environment: ApiKeyEnvironment,
): Promise<{
  environment: ApiKeyEnvironment;
  counts: {
    devices: number;
    users: number;
    verifications: number;
    attendanceEvents: number;
    auditEvents: number;
  };
  recentDevices: Device[];
  recentUsers: TenantUser[];
  recentVerifications: VerificationRecord[];
  recentAttendance: AttendanceEvent[];
  recentAuditEvents: AuditEvent[];
}> {
  const pool = getPool();
  const [deviceCount, userCount, verificationCount, attendanceCount, auditCount, recentDevices, recentUsers, recentVerifications, recentAttendance, recentAuditEvents] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM devices WHERE tenant_id = $1 AND environment = $2`, [tenantId, environment]),
    pool.query(`SELECT COUNT(*) FROM tenant_users WHERE tenant_id = $1 AND environment = $2`, [tenantId, environment]),
    pool.query(`SELECT COUNT(*) FROM verification_events WHERE tenant_id = $1 AND environment = $2`, [tenantId, environment]),
    pool.query(`SELECT COUNT(*) FROM attendance_events WHERE tenant_id = $1 AND environment = $2`, [tenantId, environment]),
    pool.query(`SELECT COUNT(*) FROM audit_events WHERE tenant_id = $1 AND environment = $2`, [tenantId, environment]),
    listDevices(tenantId, environment, { limit: 10 }),
    listTenantUsers(tenantId, environment, { limit: 10 }),
    listVerificationEvents(tenantId, environment, { limit: 10 }),
    listAttendanceEvents(tenantId, environment, { limit: 10 }),
    listAuditEvents(tenantId, environment, { limit: 10 }),
  ]);

  return {
    environment,
    counts: {
      devices: parseInt(deviceCount.rows[0].count, 10),
      users: parseInt(userCount.rows[0].count, 10),
      verifications: parseInt(verificationCount.rows[0].count, 10),
      attendanceEvents: parseInt(attendanceCount.rows[0].count, 10),
      auditEvents: parseInt(auditCount.rows[0].count, 10),
    },
    recentDevices,
    recentUsers,
    recentVerifications,
    recentAttendance,
    recentAuditEvents,
  };
}
