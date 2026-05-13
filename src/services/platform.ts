import { v4 as uuidv4 } from 'uuid';
import { getPool } from './db';
import { logger } from './logger';
import {
  ApiKeyEnvironment,
  AttendanceEvent,
  AttendanceEventType,
  AttendanceResult,
  AuditActorType,
  AuditEvent,
  AuditStatus,
  Device,
  DeviceStatus,
  TenantUser,
  TenantUserStatus,
  VerificationMethod,
  VerificationRecord,
  VerificationResult,
} from '../types';

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
  const pool = getPool();
  await pool.query(
    `INSERT INTO audit_events
      (tenant_id, environment, actor_type, actor_id, action, entity_type, entity_id, status, summary, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      tenantId,
      input.environment ?? null,
      input.actorType,
      input.actorId ?? null,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.status,
      input.summary,
      sanitizeMetadata(input.metadata),
    ],
  );
}

export async function createDevice(
  tenantId: string,
  environment: ApiKeyEnvironment,
  input: {
    externalId?: string;
    name: string;
    locationId?: string;
    batteryLevel?: number;
    metadata?: Record<string, unknown>;
  },
  actor?: AuditActor,
): Promise<Device> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO devices (tenant_id, environment, external_id, name, location_id, battery_level, metadata, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [
      tenantId,
      environment,
      defaultExternalId('device', input.externalId),
      input.name.trim(),
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
    metadata: { locationId: device.location_id, name: device.name, ...actorMetadata(actor) },
  }).catch(err => logger.warn('Failed to record audit event', { error: (err as Error).message }));

  return device;
}

export async function listDevices(
  tenantId: string,
  environment: ApiKeyEnvironment,
  options: { status?: DeviceStatus; limit?: number } = {},
): Promise<Device[]> {
  const pool = getPool();
  const params: unknown[] = [tenantId, environment];
  let query = `SELECT * FROM devices WHERE tenant_id = $1 AND environment = $2`;

  if (options.status) {
    params.push(options.status);
    query += ` AND status = $${params.length}`;
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
