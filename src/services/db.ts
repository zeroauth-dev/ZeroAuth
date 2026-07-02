import { Pool } from 'pg';
import { config } from '../config';
import { logger } from './logger';

let pool: Pool | null = null;

const SCHEMA = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  -- ═══════════════════════════════════════════════════════════
  -- ZeroAuth Platform Schema
  -- Hosted API model: tenants → api_keys → usage_logs
  -- ═══════════════════════════════════════════════════════════

  -- Leads (marketing)
  CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL CHECK (type IN ('pilot', 'whitepaper')),
    name VARCHAR(255),
    company VARCHAR(255),
    email VARCHAR(255) NOT NULL,
    size VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_leads_type ON leads(type);
  CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);

  -- ─── Tenants (developer accounts) ───────────────────────
  CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    plan VARCHAR(50) NOT NULL DEFAULT 'free'
      CHECK (plan IN ('free', 'starter', 'growth', 'enterprise')),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'suspended', 'deactivated')),
    -- Per-plan rate limits (requests per 15-minute window)
    rate_limit INT NOT NULL DEFAULT 100,
    -- Monthly quota (-1 = unlimited)
    monthly_quota INT NOT NULL DEFAULT 1000,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_tenants_email ON tenants(email);
  CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

  -- W3: per-tenant security knobs. The current consumer is the Play
  -- Integrity verdict gate on /v1/proof-pairing/sessions/:id/submit
  -- (src/services/play-integrity.ts), but the column is JSONB so we
  -- can stack additional policy keys here without another migration.
  -- Default '{}' = permissive across the board (the demo tenant stays
  -- unchanged). BFSI tenants flip require_strong_integrity=true.
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS security_policy JSONB NOT NULL DEFAULT '{}'::jsonb;

  -- ─── Pending signups (F-2 v2: byte-identical /api/console/signup) ───
  -- Holds a hashed password + intended company name keyed by a single-use
  -- verification token. Created when POST /api/console/signup is called
  -- for a fresh email; consumed when the user clicks the verify link.
  -- Lifetime: 24h, after which the row is GC'd by a periodic cleanup
  -- (the consume path also rejects expired rows defensively).
  CREATE TABLE IF NOT EXISTS pending_signups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_pending_signups_token ON pending_signups(token_hash);
  CREATE INDEX IF NOT EXISTS idx_pending_signups_expires ON pending_signups(expires_at) WHERE consumed_at IS NULL;

  -- ─── API Keys ───────────────────────────────────────────
  -- Keys are prefixed: za_live_* (production) or za_test_* (sandbox)
  -- Only the SHA-256 hash is stored; the raw key is shown once at creation.
  CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL DEFAULT 'Default',
    -- Key prefix stored in plain text for identification (e.g. "za_live_a1b2c3")
    key_prefix VARCHAR(20) NOT NULL,
    -- SHA-256 hash of the full key
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    -- Scoped permissions
    scopes TEXT[] NOT NULL DEFAULT ARRAY['zkp:verify', 'zkp:register', 'identity:read', 'nonce:create'],
    -- Environment
    environment VARCHAR(10) NOT NULL DEFAULT 'live'
      CHECK (environment IN ('live', 'test')),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'revoked')),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
  );
  CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
  CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
  CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status) WHERE status = 'active';

  -- ─── Usage Logs ─────────────────────────────────────────
  -- Append-only log for every API call, used for metering.
  CREATE TABLE IF NOT EXISTS usage_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INT,
    response_time_ms INT,
    ip_address INET,
    user_agent VARCHAR(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_usage_logs_tenant ON usage_logs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_tenant_created ON usage_logs(tenant_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at DESC);

  -- ─── Monthly Usage Aggregates (materialized for metering) ─
  CREATE TABLE IF NOT EXISTS usage_monthly (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    month DATE NOT NULL,
    total_requests INT NOT NULL DEFAULT 0,
    zkp_verifications INT NOT NULL DEFAULT 0,
    zkp_registrations INT NOT NULL DEFAULT 0,
    saml_auths INT NOT NULL DEFAULT 0,
    oidc_auths INT NOT NULL DEFAULT 0,
    UNIQUE(tenant_id, month)
  );
  CREATE INDEX IF NOT EXISTS idx_usage_monthly_tenant ON usage_monthly(tenant_id, month DESC);

  -- ─── Devices ──────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL
      CHECK (environment IN ('live', 'test')),
    external_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    location_id VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'inactive', 'retired')),
    battery_level INT CHECK (battery_level BETWEEN 0 AND 100),
    metadata JSONB NOT NULL DEFAULT '{}',
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, environment, external_id)
  );
  CREATE INDEX IF NOT EXISTS idx_devices_tenant ON devices(tenant_id, environment, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(tenant_id, environment, status);

  -- ADR 0022 production device enrollment.
  -- A device slot is created in 'pending' state by the dashboard. The
  -- server issues a one-time human-typeable enrollment code (12 chars
  -- in Crockford-base32; stored only as SHA-256, expires in 15 min)
  -- that the device exchanges for 'enrolled' state via
  -- POST /v1/devices/enroll, binding a hardware fingerprint hash and
  -- optional attestation kind (Play Integrity / App Attest / none).
  -- enrollment_state is orthogonal to status (operational state):
  -- a slot can be 'pending' while its row exists, transition to
  -- 'enrolled' on claim, and finally 'revoked' if credentials are
  -- voided. Existing rows backfill enrollment_state='enrolled' and
  -- device_type='kiosk' so the demo seed stays valid.
  ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_type VARCHAR(32) NOT NULL DEFAULT 'kiosk'
    CHECK (device_type IN ('mobile_android', 'mobile_ios', 'kiosk', 'iot_bridge', 'desktop'));
  ALTER TABLE devices ADD COLUMN IF NOT EXISTS enrollment_state VARCHAR(20) NOT NULL DEFAULT 'enrolled'
    CHECK (enrollment_state IN ('pending', 'enrolled', 'revoked'));
  ALTER TABLE devices ADD COLUMN IF NOT EXISTS enrollment_code_hash TEXT;
  ALTER TABLE devices ADD COLUMN IF NOT EXISTS enrollment_code_expires_at TIMESTAMPTZ;
  ALTER TABLE devices ADD COLUMN IF NOT EXISTS enrolled_at TIMESTAMPTZ;
  ALTER TABLE devices ADD COLUMN IF NOT EXISTS fingerprint_hash TEXT;
  ALTER TABLE devices ADD COLUMN IF NOT EXISTS attestation_kind VARCHAR(32);

  -- Hot path: device-side enroll looks up by SHA-256 of the code.
  -- Partial index because most rows have no pending code.
  CREATE INDEX IF NOT EXISTS idx_devices_enrollment_code_hash
    ON devices(enrollment_code_hash) WHERE enrollment_code_hash IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_devices_enrollment_state
    ON devices(tenant_id, environment, enrollment_state);

  -- ─── Tenant Users / Enrollments ──────────────────────────
  CREATE TABLE IF NOT EXISTS tenant_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL
      CHECK (environment IN ('live', 'test')),
    external_id VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    employee_code VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'inactive')),
    primary_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, environment, external_id)
  );
  CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id, environment, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tenant_users_status ON tenant_users(tenant_id, environment, status);

  -- ADR 0017 face-first platform pivot.
  -- The on-device biometric → embedding → secret → Poseidon commitment
  -- pipeline produces the (did, commitment) tuple. The platform stores
  -- only these — never a biometric template, never an image. The
  -- Phase 1 PII-strip migration will retire full_name/email/phone, but
  -- the new columns land now so the face-flow has a target schema.
  ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS did TEXT;
  ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS commitment TEXT;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_users_did
    ON tenant_users(tenant_id, environment, did) WHERE did IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_tenant_users_commitment
    ON tenant_users(tenant_id, environment, commitment) WHERE commitment IS NOT NULL;

  -- ─── Verification Events ─────────────────────────────────
  CREATE TABLE IF NOT EXISTS verification_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL
      CHECK (environment IN ('live', 'test')),
    user_id UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    method VARCHAR(20) NOT NULL
      CHECK (method IN ('zkp', 'fingerprint', 'face', 'depth', 'saml', 'oidc', 'manual')),
    result VARCHAR(20) NOT NULL
      CHECK (result IN ('pass', 'fail', 'challenge')),
    reason VARCHAR(255),
    confidence_score NUMERIC(5, 2),
    reference_id VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_verification_events_tenant ON verification_events(tenant_id, environment, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_verification_events_user ON verification_events(tenant_id, environment, user_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_verification_events_device ON verification_events(tenant_id, environment, device_id, occurred_at DESC);

  -- ─── Attendance Events ───────────────────────────────────
  CREATE TABLE IF NOT EXISTS attendance_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL
      CHECK (environment IN ('live', 'test')),
    user_id UUID NOT NULL REFERENCES tenant_users(id) ON DELETE CASCADE,
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    verification_id UUID REFERENCES verification_events(id) ON DELETE SET NULL,
    event_type VARCHAR(20) NOT NULL
      CHECK (event_type IN ('check_in', 'check_out')),
    result VARCHAR(20) NOT NULL
      CHECK (result IN ('accepted', 'rejected')),
    metadata JSONB NOT NULL DEFAULT '{}',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_attendance_events_tenant ON attendance_events(tenant_id, environment, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_attendance_events_user ON attendance_events(tenant_id, environment, user_id, occurred_at DESC);

  -- ─── Attendance companies (slice 2: per-tenant company + WiFi anchor) ───
  -- HR-configurable office: name + location + the WiFi presence anchor
  -- (bssids + min signal). Replaces the env-backed single company; the
  -- env fallback in attendance-company.ts still serves the demo when no
  -- row exists.
  CREATE TABLE IF NOT EXISTS attendance_companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL DEFAULT 'live'
      CHECK (environment IN ('live', 'test')),
    name VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL DEFAULT '',
    wifi JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'inactive')),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, environment, name)
  );
  CREATE INDEX IF NOT EXISTS idx_attendance_companies_tenant ON attendance_companies(tenant_id, environment);

  -- ─── Attendance memberships (provision-then-claim) ───
  -- HR provisions an employee row (status='provisioned' + a single-use
  -- invite code). The employee's phone claims it, binding the phone's
  -- DID + commitment and creating/linking a tenant_user (status='claimed').
  CREATE TABLE IF NOT EXISTS attendance_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES attendance_companies(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL DEFAULT 'live'
      CHECK (environment IN ('live', 'test')),
    user_id UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
    employee_id VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    department VARCHAR(120),
    email VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'provisioned'
      CHECK (status IN ('provisioned', 'invited', 'claimed', 'revoked')),
    invite_code_hash VARCHAR(64),
    invite_code_expires_at TIMESTAMPTZ,
    invited_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ,
    did TEXT,
    did_hash TEXT,
    commitment TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, employee_id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_invite ON attendance_memberships(invite_code_hash) WHERE invite_code_hash IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_did ON attendance_memberships(company_id, did) WHERE did IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_memberships_company_status ON attendance_memberships(company_id, status);

  -- ─── HR admins (standalone attendance admin portal auth) ───
  -- Distinct from the tenants table (developer console). An HR admin
  -- belongs to one tenant (= one customer company) and authenticates via
  -- the zeroauth-hr-admin JWT — never accepted on /v1 or /api/console.
  CREATE TABLE IF NOT EXISTS hr_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(20) NOT NULL DEFAULT 'admin'
      CHECK (role IN ('admin', 'editor', 'viewer')),
    status VARCHAR(20) NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'inactive')),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_hr_admins_tenant ON hr_admins(tenant_id);

  -- ─── Proof Pairing Sessions (W3, ADR-0009) ───────────────
  -- Desktop-issued, single-use, 5-min TTL. The session_bind cookie's
  -- sha256 is the second factor that prevents an attacker-issued QR
  -- from delivering the minted JWT to the wrong browser (A-13).
  -- Single-use enforced by atomic UPDATE ... WHERE state='issued'
  -- RETURNING * in the consume path (A-14).
  CREATE TABLE IF NOT EXISTS proof_pairing_sessions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL
      CHECK (environment IN ('live', 'test')),
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    nonce_hex VARCHAR(62) NOT NULL,                   -- 31 bytes = 62 hex chars
    session_bind_token_hash VARCHAR(64) NOT NULL,     -- sha256 of cookie value
    state VARCHAR(20) NOT NULL DEFAULT 'issued'
      CHECK (state IN ('issued', 'consumed', 'expired', 'failed')),
    consumed_user_id UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
    consumed_verification_id UUID REFERENCES verification_events(id),
    proof_hash VARCHAR(64),
    last_error_code VARCHAR(50),
    desktop_ip INET,
    desktop_user_agent VARCHAR(512),
    failure_count SMALLINT NOT NULL DEFAULT 0,
    -- Bank 2FA step-up: when a password-first login opens the session,
    -- it is PINNED to the account's bound DID — only a proof presenting
    -- this DID may consume it (enforced in proof-pairing.submitProof).
    -- NULL = unpinned (the original QR-scan flow, any enrolled DID).
    expected_did TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, nonce_hex)
  );
  CREATE INDEX IF NOT EXISTS idx_pps_tenant_created
    ON proof_pairing_sessions(tenant_id, environment, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pps_state_expires
    ON proof_pairing_sessions(state, expires_at) WHERE state = 'issued';
  -- Additive migration for deployments whose table predates the column
  -- (the bootstrap create is a no-op on existing tables).
  ALTER TABLE proof_pairing_sessions
    ADD COLUMN IF NOT EXISTS expected_did TEXT;
  -- The app's approval-inbox poll: issued sessions pinned to a DID.
  CREATE INDEX IF NOT EXISTS idx_pps_expected_did
    ON proof_pairing_sessions(tenant_id, environment, expected_did)
    WHERE state = 'issued' AND expected_did IS NOT NULL;

  -- ─── NeoBank demo accounts (bank 2FA showcase) ─────────────
  -- The demo bank's OWN user store: id + password stay with the bank;
  -- ZeroAuth is the verification layer it delegates step-up to. The
  -- bound did column is a POINTER to the ZeroAuth identity — no
  -- biometric data, no commitment, nothing derivable lives here.
  CREATE TABLE IF NOT EXISTS demo_bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL
      CHECK (environment IN ('live', 'test')),
    customer_id VARCHAR(160) NOT NULL,          -- the bank login id (email)
    password_hash TEXT NOT NULL,                -- scrypt salt:hex
    full_name VARCHAR(120) NOT NULL,
    did TEXT,                                   -- bound ZeroAuth identity
    tenant_user_id UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
    registration_session_id UUID REFERENCES registration_sessions(id) ON DELETE SET NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending_enrollment'
      CHECK (status IN ('pending_enrollment', 'active', 'locked')),
    failed_login_count SMALLINT NOT NULL DEFAULT 0,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, environment, customer_id)
  );
  CREATE INDEX IF NOT EXISTS idx_demo_bank_did
    ON demo_bank_accounts(tenant_id, environment, did) WHERE did IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_demo_bank_reg_session
    ON demo_bank_accounts(registration_session_id);

  -- ─── Registration Sessions (ADR 0023) ─────────────────────
  -- The end-user signup ceremony: a tenant SDK calls
  -- POST /v1/registrations to start a session, gets back a
  -- pair_code; the user's phone scans QR1 to enroll the device,
  -- captures a biometric, scans QR2 to submit the commitment, then
  -- scans QR3 to submit a Groth16 proof binding (commitment,
  -- challenge_nonce). The tenant_user is created only when the
  -- proof verifies. The biometric NEVER touches the server — only
  -- the commitment and the proof do.
  --
  -- State machine:
  --   awaiting_device      — pair_code outstanding, no device yet
  --   awaiting_commitment  — device paired, enroll_code outstanding
  --   awaiting_verification — commitment stored, verify_code outstanding
  --   completed            — tenant_user created
  --   abandoned            — session expired or admin-cancelled
  --
  -- Three independent codes (each a one-time SHA-256-hashed bearer
  -- credential, each with its own 15-minute TTL) prevent confused-
  -- deputy reuse across steps: a captured QR1 cannot satisfy QR2's
  -- handler, and so on.
  CREATE TABLE IF NOT EXISTS registration_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL
      CHECK (environment IN ('live', 'test')),
    -- Free-form profile blob the tenant SDK passes through (name,
    -- email, employee_code, etc.). Validation is the tenant's
    -- responsibility; we treat it as opaque JSON. NO biometric data
    -- ever lives here; the biometric column-name guard in
    -- tests/schema-purity.test.ts asserts this.
    profile JSONB NOT NULL DEFAULT '{}',
    state VARCHAR(32) NOT NULL DEFAULT 'awaiting_device'
      CHECK (state IN ('awaiting_device', 'awaiting_commitment', 'awaiting_verification', 'completed', 'abandoned')),
    -- Bound progressively as the ceremony advances:
    device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
    did TEXT,
    commitment TEXT,
    tenant_user_id UUID REFERENCES tenant_users(id) ON DELETE SET NULL,
    -- Three single-use bearer codes, one per step. SHA-256 of plaintext.
    pair_code_hash TEXT,
    pair_code_expires_at TIMESTAMPTZ,
    enroll_code_hash TEXT,
    enroll_code_expires_at TIMESTAMPTZ,
    verify_code_hash TEXT,
    verify_code_expires_at TIMESTAMPTZ,
    -- Server-issued nonce baked into the QR3 payload; the phone
    -- echoes it back with the proof. Single-use, scoped to this row.
    verify_challenge_nonce TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_registration_sessions_tenant
    ON registration_sessions(tenant_id, environment, state, created_at DESC);
  -- Hot paths: phone-side endpoints find rows by code hash. Partial
  -- index because most rows have no outstanding code in any one step.
  CREATE INDEX IF NOT EXISTS idx_registration_sessions_pair_code
    ON registration_sessions(pair_code_hash) WHERE pair_code_hash IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_registration_sessions_enroll_code
    ON registration_sessions(enroll_code_hash) WHERE enroll_code_hash IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_registration_sessions_verify_code
    ON registration_sessions(verify_code_hash) WHERE verify_code_hash IS NOT NULL;

  -- ─── Audit Events ────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS audit_events (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10)
      CHECK (environment IN ('live', 'test')),
    actor_type VARCHAR(20) NOT NULL
      CHECK (actor_type IN ('api_key', 'console', 'device', 'system', 'hr_admin')),
    actor_id VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(255),
    status VARCHAR(20) NOT NULL
      CHECK (status IN ('success', 'failure')),
    summary VARCHAR(255) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_audit_events_tenant ON audit_events(tenant_id, environment, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(tenant_id, action, created_at DESC);

  -- Widen actor_type for the HR admin portal (slice-2). The inline CHECK
  -- above only applies on first CREATE; existing deployments need the
  -- DROP/ADD to pick up 'hr_admin'. Keep this list in lockstep with the
  -- AuditActorType union in src/types/index.ts — schema-purity.test.ts
  -- asserts they never drift.
  ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_type_check;
  ALTER TABLE audit_events ADD CONSTRAINT audit_events_actor_type_check
    CHECK (actor_type IN ('api_key', 'console', 'device', 'system', 'hr_admin'));

  -- ─── ADR 0013 hash chain columns ─────────────────────────
  -- previous_hash and event_hash are computed at INSERT time by
  -- src/services/audit.ts. Both are NULLABLE during the Phase 1
  -- backfill window (C-121); after backfill they are constrained
  -- NOT NULL and a CHECK enforces non-empty hex.
  ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS previous_hash TEXT;
  ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_hash TEXT;
  CREATE INDEX IF NOT EXISTS idx_audit_events_chain ON audit_events(tenant_id, environment, id);

  -- AL-1: when present, the chain hashes MUST be well-formed (0x + 64 hex;
  -- previous_hash may also be the literal 'genesis'). NULL is still allowed
  -- for leading legacy rows that predate the chain — verifyAuditChain()
  -- fails closed on any NULL that appears AFTER the chain has started, so a
  -- tamperer can't hide a mutation by clearing the two hash columns.
  ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_event_hash_format;
  ALTER TABLE audit_events ADD CONSTRAINT audit_events_event_hash_format
    CHECK (event_hash IS NULL OR event_hash ~ '^0x[0-9a-f]{64}$');
  ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_previous_hash_format;
  ALTER TABLE audit_events ADD CONSTRAINT audit_events_previous_hash_format
    CHECK (previous_hash IS NULL OR previous_hash = 'genesis' OR previous_hash ~ '^0x[0-9a-f]{64}$');

  -- ─── Audit Anchors (ADR 0014) ────────────────────────────
  -- One row per (tenant_id, environment, day_utc) recording the
  -- on-chain anchor of the audit-events chain terminal hash for
  -- that day. tx_hash and block_number are NULL until the staged
  -- transaction is signed and broadcast by the off-process signer
  -- (Base Sepolia keys are not loaded inside the API container).
  -- recordAnchor() on contracts/AuditAnchor.sol (C-016, d6c6a4e)
  -- enforces write-once on chain; the UNIQUE constraint mirrors
  -- that in the DB so a second stage call for the same key is a no-op.
  CREATE TABLE IF NOT EXISTS audit_anchors (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment     VARCHAR(10) CHECK (environment IN ('live','test')),
    day_utc         DATE NOT NULL,
    terminal_hash   TEXT NOT NULL,
    row_count       BIGINT NOT NULL,
    tx_hash         TEXT,
    block_number    BIGINT,
    anchored_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, environment, day_utc)
  );
  CREATE INDEX IF NOT EXISTS idx_audit_anchors_day ON audit_anchors(day_utc DESC);

  -- ─── User sessions (C-025 / audit finding C-9) ─────────
  --
  -- Postgres-backed session storage. The in-memory SessionStore
  -- hydrates this table on boot and writes through asynchronously on
  -- create/delete, so a process restart no longer loses sessions.
  --
  -- Horizontal scale-out (a second API pod reading another pod's
  -- sessions) is a follow-on — for now reads are still served from
  -- the local in-memory cache. The DB write is the durability layer.
  --
  -- Cleanup of expired rows runs hourly (src/services/session-store.ts).
  CREATE TABLE IF NOT EXISTS user_sessions (
    session_id   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    provider     VARCHAR(20) NOT NULL
      CHECK (provider IN ('saml', 'oidc', 'zkp')),
    verified     BOOLEAN NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL,
    did          TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);

  -- ─── Rate-limit buckets (C-026 / audit finding C-10) ─────
  -- Postgres-backed sliding-window rate-limit counters. One row per
  -- (route, key, window-start) tuple; expired rows GC'd periodically
  -- by cleanupRateLimitBuckets() (src/middleware/rate-limit.ts).
  --
  -- The bucket is bucketed per key (apiKey id, IP, or both) not per
  -- (tenant_id, environment), because some buckets — notably the
  -- /api/console/login bucket — exist BEFORE any tenant is resolved.
  -- That makes this table the only table in the schema that is
  -- intentionally not (tenant_id, environment)-scoped. The PK is the
  -- composite bucket_key string so atomic UPSERT works without a
  -- separate uniqueness index.
  CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    bucket_key   TEXT PRIMARY KEY,
    count        INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON rate_limit_buckets(expires_at);

  -- ─── Tenant Webhooks ─────────────────────────────────────
  -- Outbound delivery destinations registered by a tenant. The
  -- platform POSTs JSON events (verification.recorded,
  -- attendance.checked_in, device.enrolled, etc.) to the url, signed
  -- with HMAC-SHA256 of the canonical body using the secret. The
  -- receiving service verifies the signature against its copy of
  -- the secret to authenticate the call.
  --
  -- Secret handling:
  --   - secret is generated server-side (32 random bytes, base64url
  --     encoded with a whsec_ prefix). It is shown to the operator
  --     EXACTLY ONCE at creation time and stored in the row so the
  --     delivery worker can sign outbound payloads. The v1 mitigation
  --     for rotation is "DELETE + recreate."
  --   - The column is plaintext-at-rest (not hashed) because the
  --     server itself must hold the signing material. Encryption at
  --     rest at the disk layer is the only confidentiality boundary
  --     today; column-level KMS encryption is a follow-on.
  --
  -- event_filter is a TEXT[] of action wildcards: the * sentinel
  -- allows all events; "verification.*" allows every verification-class
  -- action; "device.enrolled" allows exactly that one action. The
  -- delivery worker matches the audit row's action against the filter
  -- list before scheduling a POST. An empty array is rejected at the
  -- API layer — * is the explicit "everything" sentinel.
  --
  -- enabled is the operator-facing kill switch. The delivery worker
  -- skips disabled rows without removing them so the operator can
  -- pause + resume without losing the secret + filter.
  CREATE TABLE IF NOT EXISTS tenant_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment VARCHAR(10) NOT NULL DEFAULT 'live'
      CHECK (environment IN ('live', 'test')),
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    event_filter TEXT[] NOT NULL DEFAULT ARRAY['*'],
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    description VARCHAR(255),
    last_delivery_at TIMESTAMPTZ,
    last_delivery_status VARCHAR(20)
      CHECK (last_delivery_status IS NULL OR last_delivery_status IN ('success', 'failure')),
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_tenant_webhooks_tenant
    ON tenant_webhooks(tenant_id, environment, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_tenant_webhooks_enabled
    ON tenant_webhooks(tenant_id, environment, enabled) WHERE enabled = TRUE;
`;

export async function initDb(): Promise<void> {
  pool = new Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
    logger.info('PostgreSQL connected and schema ready', {
      host: config.postgres.host,
      database: config.postgres.database,
    });
  } finally {
    client.release();
  }
}

export function getPool(): Pool {
  if (!pool) throw new Error('Database not initialized. Call initDb() first.');
  return pool;
}

export function getPoolOrNull(): Pool | null {
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL pool closed');
  }
}
