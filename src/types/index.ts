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

export interface SAMLProfile {
  nameID: string;
  nameIDFormat?: string;
  issuer?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
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

export interface Device {
  id: string;
  tenant_id: string;
  environment: ApiKeyEnvironment;
  external_id: string;
  name: string;
  location_id: string | null;
  status: DeviceStatus;
  battery_level: number | null;
  metadata: Record<string, unknown>;
  last_seen_at: Date | null;
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
