// ─── Groth16 ZKP Types ───────────────────────────────────────────────

export interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: 'groth16';
  curve: 'bn128';
}

export interface ZKPVerificationRequest {
  /** Groth16 proof object from client-side snarkjs */
  proof: Groth16Proof;
  /** Public signals: [commitment, didHash, identityBinding] */
  publicSignals: [string, string, string];
  /** Unique session nonce to prevent replay */
  nonce: string;
  /** Timestamp of proof generation (ISO 8601) */
  timestamp: string;
}

export interface ZKPVerificationResponse {
  verified: boolean;
  sessionId: string;
  /** Proof was validated without storing biometric data */
  dataStored: false;
  timestamp: string;
  /** On-chain verification tx hash (if VERIFY_ON_CHAIN=true) */
  txHash?: string;
}

// ─── Registration Types ──────────────────────────────────────────────

export interface RegistrationRequest {
  /** Base64-encoded biometric template from client */
  biometricTemplate: string;
}

export interface RegistrationResponse {
  /** Decentralized Identifier */
  did: string;
  /** Poseidon commitment (public, stored on-chain) */
  commitment: string;
  /** Poseidon hash of DID (public input for circuit) */
  didHash: string;
  /** Client secret — user must store securely, never sent again */
  biometricSecret: string;
  /** Salt used in commitment — user must store securely */
  salt: string;
  /** Blockchain tx hash */
  txHash: string;
  /** Block number */
  blockNumber: number;
  /** Data storage confirmation */
  dataStored: false;
  message: string;
}

// ─── Blockchain Types ────────────────────────────────────────────────

export interface BlockchainInfo {
  network: string;
  chainId: number;
  rpcUrl: string;
  contracts: {
    DIDRegistry: string;
    Verifier: string;
  };
  identityCount: number;
  latestBlock: number;
  deployerAddress: string;
}

// ─── Auth & Session Types ────────────────────────────────────────────

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface UserSession {
  sessionId: string;
  userId: string;
  provider: 'saml' | 'oidc' | 'zkp';
  verified: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface AdminStats {
  totalVerifications: number;
  activeSessionCount: number;
  providerBreakdown: {
    saml: number;
    oidc: number;
    zkp: number;
  };
  dataStorageConfirmation: {
    biometricDataStored: false;
    message: string;
  };
  uptimeSeconds: number;
  blockchain?: {
    network: string;
    identityCount: number;
    didRegistryAddress: string;
    verifierAddress: string;
  };
}

export interface OIDCTokenSet {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_at?: number;
}

export interface OIDCUserInfo {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export interface JWTPayload {
  sub: string;
  email?: string;
  name?: string;
  provider: 'saml' | 'oidc' | 'zkp';
  verified: boolean;
  sessionId: string;
  did?: string;
  iat?: number;
  exp?: number;
}

// ─── Tenant / API Key Types (Hosted Platform) ──────────────────────

export type PlanTier = 'free' | 'starter' | 'growth' | 'enterprise';
export type TenantStatus = 'active' | 'suspended' | 'deactivated';
export type ApiKeyEnvironment = 'live' | 'test';
export type ApiKeyStatus = 'active' | 'revoked';
export type DeviceStatus = 'active' | 'inactive' | 'retired';
export type TenantUserStatus = 'active' | 'inactive';
export type VerificationMethod =
  | 'zkp'
  | 'fingerprint'
  | 'face'
  | 'depth'
  | 'saml'
  | 'oidc'
  | 'manual';
export type VerificationResult = 'pass' | 'fail' | 'challenge';
export type AttendanceEventType = 'check_in' | 'check_out';
export type AttendanceResult = 'accepted' | 'rejected';
export type AuditActorType = 'api_key' | 'console' | 'device' | 'system';
export type AuditStatus = 'success' | 'failure';

export type ApiScope =
  | 'zkp:verify'
  | 'zkp:register'
  | 'identity:read'
  | 'nonce:create'
  | 'saml:login'
  | 'saml:callback'
  | 'oidc:authorize'
  | 'oidc:callback'
  | 'devices:read'
  | 'devices:write'
  | 'users:read'
  | 'users:write'
  | 'verifications:read'
  | 'verifications:write'
  | 'attendance:read'
  | 'attendance:write'
  | 'audit:read'
  | 'proof_pairing:create'
  | 'proof_pairing:claim'
  | 'admin:stats'
  | 'admin:audit';

export const PLAN_LIMITS: Record<PlanTier, { rateLimit: number; monthlyQuota: number }> = {
  free:       { rateLimit: 100,   monthlyQuota: 1_000 },
  starter:    { rateLimit: 500,   monthlyQuota: 25_000 },
  growth:     { rateLimit: 2_000, monthlyQuota: 250_000 },
  enterprise: { rateLimit: 10_000, monthlyQuota: -1 },  // -1 = unlimited
};

export interface Tenant {
  id: string;
  email: string;
  password_hash: string;
  company_name: string | null;
  plan: PlanTier;
  status: TenantStatus;
  rate_limit: number;
  monthly_quota: number;
  metadata: Record<string, unknown>;
  /**
   * Per-tenant policy knobs stored as JSONB. Defaults to `{}` at the DB
   * level (see `src/services/db.ts`). The interpretation lives in
   * `TenantSecurityPolicy`; consumers go through
   * `src/services/tenant-providers.ts` for the ADR 0017 provider triple
   * and `src/services/play-integrity.ts` for the verdict gate.
   */
  security_policy: TenantSecurityPolicy | null;
  created_at: Date;
  updated_at: Date;
}

export interface ApiKey {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: ApiScope[];
  environment: ApiKeyEnvironment;
  status: ApiKeyStatus;
  last_used_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  revoked_at: Date | null;
}

export interface ApiKeyCreateResult {
  /** Full key — shown once, never stored */
  key: string;
  id: string;
  name: string;
  key_prefix: string;
  scopes: ApiScope[];
  environment: ApiKeyEnvironment;
  created_at: Date;
}

export interface UsageLog {
  id: number;
  tenant_id: string;
  api_key_id: string | null;
  endpoint: string;
  method: string;
  status_code: number | null;
  response_time_ms: number | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export interface UsageSummary {
  period: string;
  total_requests: number;
  zkp_verifications: number;
  zkp_registrations: number;
  saml_auths: number;
  oidc_auths: number;
}

/** Tenant context attached to every authenticated API request */
export interface TenantContext {
  tenant: Tenant;
  apiKey: ApiKey;
}

// ─── Central API Domain Types ────────────────────────────────────────

/**
 * Device-type taxonomy. Drives the dashboard's icon picker and the
 * default attestation expectation on enrollment (mobile_android →
 * Play Integrity verdict, mobile_ios → App Attest, kiosk/iot_bridge
 * → none, desktop → WebAuthn (Phase 2)).
 */
export type DeviceType =
  | 'mobile_android'
  | 'mobile_ios'
  | 'kiosk'
  | 'iot_bridge'
  | 'desktop';

/**
 * Enrollment-state machine for a device row. Orthogonal to `status`
 * (operational state). See ADR 0022.
 *
 *   pending  — slot created by admin, awaiting device claim with code
 *   enrolled — device claimed; hardware fingerprint bound
 *   revoked  — credentials voided; row retained for audit
 */
export type DeviceEnrollmentState = 'pending' | 'enrolled' | 'revoked';

export interface Device {
  id: string;
  tenant_id: string;
  environment: ApiKeyEnvironment;
  external_id: string;
  name: string;
  device_type: DeviceType;
  location_id: string | null;
  status: DeviceStatus;
  enrollment_state: DeviceEnrollmentState;
  // The plaintext enrollment code is never persisted; only its SHA-256.
  // Cleared (set NULL) once the code is consumed or the slot is cancelled.
  enrollment_code_hash: string | null;
  enrollment_code_expires_at: Date | null;
  enrolled_at: Date | null;
  // SHA-256 of the device-supplied fingerprint (e.g. android_id +
  // installation_id, kiosk serial + MAC). Recorded at enrollment, used
  // to detect device-row re-use on subsequent claims.
  fingerprint_hash: string | null;
  // Free-form tag: 'play-integrity' | 'app-attest' | 'webauthn' | 'none'.
  // The actual attestation blob lives in audit_events.metadata, never
  // on the device row.
  attestation_kind: string | null;
  battery_level: number | null;
  metadata: Record<string, unknown>;
  last_seen_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Three-step end-user signup ceremony (ADR 0023).
 *
 *   awaiting_device      — pair_code outstanding, no device yet
 *   awaiting_commitment  — device paired, enroll_code outstanding
 *   awaiting_verification — commitment stored, verify_code outstanding
 *   completed            — tenant_user created
 *   abandoned            — session expired or admin-cancelled
 */
export type RegistrationSessionState =
  | 'awaiting_device'
  | 'awaiting_commitment'
  | 'awaiting_verification'
  | 'completed'
  | 'abandoned';

export interface RegistrationSession {
  id: string;
  tenant_id: string;
  environment: ApiKeyEnvironment;
  profile: Record<string, unknown>;
  state: RegistrationSessionState;
  device_id: string | null;
  did: string | null;
  commitment: string | null;
  tenant_user_id: string | null;
  // Plaintext codes never live on the row — only their SHA-256 hashes.
  pair_code_hash: string | null;
  pair_code_expires_at: Date | null;
  enroll_code_hash: string | null;
  enroll_code_expires_at: Date | null;
  verify_code_hash: string | null;
  verify_code_expires_at: Date | null;
  verify_challenge_nonce: string | null;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface TenantUser {
  id: string;
  tenant_id: string;
  environment: ApiKeyEnvironment;
  external_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  employee_code: string | null;
  status: TenantUserStatus;
  primary_device_id: string | null;
  metadata: Record<string, unknown>;
  last_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface VerificationRecord {
  id: string;
  tenant_id: string;
  environment: ApiKeyEnvironment;
  user_id: string | null;
  device_id: string | null;
  api_key_id: string | null;
  method: VerificationMethod;
  result: VerificationResult;
  reason: string | null;
  confidence_score: number | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  occurred_at: Date;
  created_at: Date;
}

export interface AttendanceEvent {
  id: string;
  tenant_id: string;
  environment: ApiKeyEnvironment;
  user_id: string;
  device_id: string | null;
  verification_id: string | null;
  event_type: AttendanceEventType;
  result: AttendanceResult;
  metadata: Record<string, unknown>;
  occurred_at: Date;
  created_at: Date;
}

export interface AuditEvent {
  id: number;
  tenant_id: string;
  environment: ApiKeyEnvironment | null;
  actor_type: AuditActorType;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  status: AuditStatus;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

// ─── Proof Pairing Types (W3, ADR-0009) ──────────────────────────────

export type ProofPairingState = 'issued' | 'consumed' | 'expired' | 'failed';

/** DB row shape for `proof_pairing_sessions`. */
export interface ProofPairingSession {
  id: string;
  tenant_id: string;
  environment: ApiKeyEnvironment;
  api_key_id: string | null;
  nonce_hex: string;
  session_bind_token_hash: string;
  state: ProofPairingState;
  consumed_user_id: string | null;
  consumed_verification_id: string | null;
  proof_hash: string | null;
  last_error_code: string | null;
  desktop_ip: string | null;
  desktop_user_agent: string | null;
  failure_count: number;
  /** Bank 2FA: DID the session is pinned to; NULL = unpinned QR flow. */
  expected_did: string | null;
  /** Human label for the approval inbox ("Pay ₹5,000 to Priya"); NULL = login. */
  context_label: string | null;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

// ─── Play Integrity (W3 enforcement; ADR-0009, threat A-18) ─────────

/**
 * The subset of Play Integrity verdict labels we recognise. The values
 * mirror the names Google emits in the device-integrity verdict but
 * are kept as a closed enum here so a future Play API change doesn't
 * silently widen what counts as "strong".
 *
 * Ranks (higher = stronger):
 *   0 — absent or UNKNOWN     (no signal)
 *   1 — INTEGRITY_NOT_EVALUATED  (Play didn't evaluate)
 *   2 — MEETS_BASIC_INTEGRITY (rooted phones, custom ROMs)
 *   3 — MEETS_DEVICE_INTEGRITY (stock Android, Play Protect on)
 *   4 — MEETS_STRONG_INTEGRITY (StrongBox-equivalent, locked bootloader)
 */
export type PlayIntegrityVerdict =
  | 'MEETS_STRONG_INTEGRITY'
  | 'MEETS_DEVICE_INTEGRITY'
  | 'MEETS_BASIC_INTEGRITY'
  | 'INTEGRITY_NOT_EVALUATED'
  | 'UNKNOWN';

/** Numeric rank so policy comparison reduces to a single `>=`. */
export function verdictRank(v: string | undefined | null): number {
  switch (v) {
    case 'MEETS_STRONG_INTEGRITY': return 4;
    case 'MEETS_DEVICE_INTEGRITY': return 3;
    case 'MEETS_BASIC_INTEGRITY': return 2;
    case 'INTEGRITY_NOT_EVALUATED': return 1;
    default: return 0;
  }
}

/**
 * Per-tenant security policy stored as JSONB on `tenants.security_policy`.
 * All fields are optional; absent fields mean "permissive" (any verdict
 * accepted, including absent). A demo tenant runs with `{}`; a BFSI
 * pilot enforces `require_strong_integrity: true` + `allow_play_integrity_absent: false`.
 */
export interface TenantSecurityPolicy {
  /** Require MEETS_STRONG_INTEGRITY (rank ≥ 4) on every submit. */
  require_strong_integrity?: boolean;
  /** Require MEETS_DEVICE_INTEGRITY (rank ≥ 3) on every submit. */
  require_device_integrity?: boolean;
  /** Require MEETS_BASIC_INTEGRITY (rank ≥ 2) on every submit. */
  require_basic_integrity?: boolean;
  /**
   * When any of the above requires is true, this knob controls what
   * happens to a submit with NO presented verdict. Default behaviour
   * (false): reject with 400 `play_integrity_required`. Set true to
   * permit submits while the field plumbing rolls out client-side.
   */
  allow_play_integrity_absent?: boolean;
  /**
   * @deprecated Removed by Phase 0 audit finding C-1 closure.
   * The shortcut that this knob used to enable in
   * `src/services/proof-pairing.ts` is gone. The field is kept on the
   * type for one release for backward compatibility with any tenant
   * record still carrying it; it is ignored by the verifier. Remove
   * after a schema migration that strips it from `security_policy`
   * JSON across all rows (planned for Phase 1).
   */
  pairing_demo_mode?: boolean;
  /**
   * Per-tenant browser origin allowlist for tenant-scoped surfaces
   * (kiosk + admin dashboard for the Anchor Bank demo, partner-branded
   * surfaces later). Carried inside `security_policy` rather than its
   * own column so we can extend the JSONB without another migration.
   * The platform CORS allowlist still lives at `config.cors.origins`;
   * this field is consulted only when a route already knows which
   * tenant the request belongs to (e.g. a kiosk paired to a tenant).
   * Empty / undefined ⇒ no per-tenant restriction. Seeded by
   * `scripts/seed-demo-tenants.ts` (C-108) for the Anchor Bank tenant.
   */
  allowed_origins?: string[];

  // ─── ADR 0017: blockchain-agnostic provider slots ──────────────────
  // Three independent provider slots, each opt-in per tenant. Defaults
  // are off-chain across the board so a fresh tenant runs with zero
  // blockchain dependency. The resolver lives in
  // `src/services/tenant-providers.ts`; the gates live in
  // `src/services/identity.ts`, `src/services/anchor-job.ts`, and
  // `src/services/zkp.ts`. See `adr/0017-blockchain-agnostic-posture.md`.

  /** Where DIDs are registered. Default: 'off-chain' (DB only, no chain). */
  did_provider?: 'off-chain' | 'base-sepolia' | 'base-mainnet' | 'custom-chain';
  /** Whether to additionally re-verify proofs on-chain. Default: 'off-chain' (snarkjs only). */
  verifier_provider?: 'off-chain' | 'on-chain';
  /** Where the audit chain is anchored. Default: 'none' (hash chain only). */
  audit_anchor_provider?: 'none' | 'signed-transcript' | 'base-sepolia' | 'base-mainnet' | 'witness-cosign';
  /** Custom chain provider config (when did_provider='custom-chain'). */
  base_rpc_url?: string;
  did_registry_address?: string;
  groth16_verifier_address?: string;
  audit_anchor_contract_address?: string;
  audit_anchor_signing_key_id?: string;
}

// ─── Lead Types ─────────────────────────────────────────────────────

export interface LeadRow {
  id: number;
  type: 'pilot' | 'whitepaper';
  name: string | null;
  company: string | null;
  email: string;
  size: string | null;
  created_at: Date;
}

export interface LeadsResponse {
  total: number;
  pilot: number;
  whitepaper: number;
  leads: LeadRow[];
}
