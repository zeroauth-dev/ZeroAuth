import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value ?? '';
}

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (raw && raw.trim().length > 0) {
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  }
  // Fallback: derive from the resolved public URLs in prod, dev defaults otherwise.
  if (process.env.NODE_ENV === 'production') {
    return [
      process.env.API_BASE_URL ?? 'https://api.zeroauth.dev',
      process.env.CONSOLE_BASE_URL ?? 'https://console.zeroauth.dev',
      process.env.DOCS_BASE_URL ?? 'https://docs.zeroauth.dev',
      process.env.LANDING_BASE_URL ?? 'https://zeroauth.dev',
    ];
  }
  return ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5050'];
}

// Demo-auth gate: the legacy SAML/OIDC routes are not real protocol
// implementations — they only simulate the assertion exchange. They are off
// by default in production and must be opted into with ENABLE_DEMO_AUTH=true.
// In development the gate defaults to on so the existing tests keep running.
function resolveDemoAuthFlag(): boolean {
  const raw = process.env.ENABLE_DEMO_AUTH;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3000',
  /**
   * Public-facing URLs for the four product surfaces. After the
   * subdomain refactor these resolve to:
   *   api      → https://api.zeroauth.dev
   *   console  → https://console.zeroauth.dev
   *   docs     → https://docs.zeroauth.dev
   *   landing  → https://zeroauth.dev
   * In dev they collapse onto a single Express host so the existing
   * round-trip tests don't need DNS plumbing.
   */
  consoleBaseUrl: process.env.CONSOLE_BASE_URL ?? (process.env.NODE_ENV === 'production' ? 'https://console.zeroauth.dev' : 'http://localhost:3000/dashboard'),
  docsBaseUrl: process.env.DOCS_BASE_URL ?? (process.env.NODE_ENV === 'production' ? 'https://docs.zeroauth.dev' : 'http://localhost:3000/docs'),
  landingBaseUrl: process.env.LANDING_BASE_URL ?? (process.env.NODE_ENV === 'production' ? 'https://zeroauth.dev' : 'http://localhost:3000'),
  corsOrigins: parseCorsOrigins(),
  trustProxy: process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production',
  enableDemoAuth: resolveDemoAuthFlag(),

  jwt: {
    secret: requireEnv('JWT_SECRET', 'dev-secret-change-me'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
    // C-11 / ADR 0021: RS256 migration. When `algorithm = 'RS256'`,
    // the JWT service signs with `privateKey` and the verifier
    // accepts both RS256 (with `publicKey`) and HS256 (the legacy
    // `secret` above) during the rollover window. The JWKS endpoint
    // at /.well-known/jwks.json publishes the RS256 public key.
    // Defaults to HS256 so existing deployments keep working unchanged.
    // The algorithm is RS256 when any of these hold:
    //   - JWT_ALGORITHM=RS256 is set explicitly, OR
    //   - the convenience aliases JWT_PRIVATE_KEY + JWT_PUBLIC_KEY are
    //     both set (no need to also set JWT_ALGORITHM=RS256). This is
    //     the surface ADR 0021's operator runbook recommends because
    //     setting one key without the other is almost always a bug,
    //     and the algorithm choice falls out of "do I have a keypair?"
    //   - the legacy aliases JWT_RS256_PRIVATE_KEY + JWT_RS256_PUBLIC_KEY
    //     are both set. Older production env files (and the
    //     /.well-known/jwks.json test surface) predate ADR 0021's rename
    //     to the un-prefixed names; honouring them here means an
    //     operator can rename incrementally without flipping any flags.
    //     The new names still win when both pairs are set (see
    //     `privateKey` / `publicKey` resolution below).
    // Falls back to HS256 otherwise so existing deployments keep working.
    algorithm: (
      process.env.JWT_ALGORITHM === 'RS256' ||
      ((process.env.JWT_PRIVATE_KEY ?? '').length > 0 &&
        (process.env.JWT_PUBLIC_KEY ?? '').length > 0) ||
      ((process.env.JWT_RS256_PRIVATE_KEY ?? '').length > 0 &&
        (process.env.JWT_RS256_PUBLIC_KEY ?? '').length > 0)
        ? 'RS256'
        : 'HS256'
    ) as 'HS256' | 'RS256',
    // JWT_PRIVATE_KEY / JWT_PUBLIC_KEY are the new, recommended env
    // vars (per ADR 0021). The legacy JWT_RS256_PRIVATE_KEY /
    // JWT_RS256_PUBLIC_KEY names remain accepted as fallbacks so the
    // existing /.well-known/jwks.json tests + production env files
    // continue to work. The new names win when both are set.
    privateKey:
      process.env.JWT_PRIVATE_KEY ?? process.env.JWT_RS256_PRIVATE_KEY ?? '',
    publicKey:
      process.env.JWT_PUBLIC_KEY ?? process.env.JWT_RS256_PUBLIC_KEY ?? '',
    /** Key ID exposed in the JWKS for client-side selection. */
    keyId:
      process.env.JWT_KID ??
      process.env.JWT_RS256_KID ??
      'zeroauth-rs256-1',
  },

  saml: {
    entryPoint: process.env.SAML_ENTRY_POINT ?? 'https://idp.example.com/sso/saml',
    issuer: process.env.SAML_ISSUER ?? 'zeroauth-sp',
    callbackUrl: process.env.SAML_CALLBACK_URL ?? 'http://localhost:3000/api/auth/saml/callback',
    cert: process.env.SAML_CERT ?? '',
  },

  oidc: {
    issuer: process.env.OIDC_ISSUER ?? 'https://accounts.google.com',
    clientId: process.env.OIDC_CLIENT_ID ?? '',
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
    redirectUri: process.env.OIDC_REDIRECT_URI ?? 'http://localhost:3000/api/auth/oidc/callback',
  },

  session: {
    secret: requireEnv('SESSION_SECRET', 'dev-session-secret'),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '900000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '300', 10),
  },

  admin: {
    apiKey: requireEnv('ADMIN_API_KEY', 'dev-admin-key'),
  },

  log: {
    level: process.env.LOG_LEVEL ?? 'info',
  },

  blockchain: {
    rpcUrl: process.env.BLOCKCHAIN_RPC_URL ?? 'https://sepolia.base.org',
    chainId: parseInt(process.env.BLOCKCHAIN_CHAIN_ID ?? '84532', 10),
    privateKey: process.env.BLOCKCHAIN_PRIVATE_KEY ?? '',
    didRegistryAddress: process.env.DID_REGISTRY_ADDRESS ?? '',
    verifierAddress: process.env.VERIFIER_CONTRACT_ADDRESS ?? '',
    verifyOnChain: process.env.VERIFY_ON_CHAIN === 'true',
  },

  zkp: {
    wasmPath: process.env.ZKP_WASM_PATH ?? 'circuits/build/identity_proof_js/identity_proof.wasm',
    zkeyPath: process.env.ZKP_ZKEY_PATH ?? 'circuits/build/circuit_final.zkey',
    vkeyPath: process.env.ZKP_VKEY_PATH ?? 'circuits/build/verification_key.json',
    // B02 — the verifier service ([Plan B, TS workspace](../../verifier/README.md)).
    // When set, src/services/zkp.ts delegates Groth16 verification over
    // loopback HTTP instead of running snarkjs inline. Unset → inline
    // fallback (the v0 behavior; will be removed in a follow-up once the
    // verifier is in production).
    verifierUrl: process.env.VERIFIER_URL ?? '',
    verifierTimeoutMs: parseInt(process.env.VERIFIER_TIMEOUT_MS ?? '2000', 10),
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    useRedis: process.env.USE_REDIS_SESSIONS === 'true',
  },

  postgres: {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    database: process.env.POSTGRES_DB ?? 'zeroauth',
    user: process.env.POSTGRES_USER ?? 'zeroauth',
    password: requireEnv('POSTGRES_PASSWORD', 'zeroauth-dev'),
  },

  // ADR-0005 — transactional SMTP via nodemailer + Brevo.
  // All five env vars must be set in production for emails to actually
  // send; when SMTP_HOST is empty src/services/email.ts no-ops with a
  // warn log instead of failing requests.
  email: {
    smtpHost: process.env.SMTP_HOST ?? '',
    smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
    smtpUser: process.env.SMTP_USER ?? '',
    smtpPassword: process.env.SMTP_PASSWORD ?? '',
    fromAddress: process.env.EMAIL_FROM ?? 'noreply@zeroauth.dev',
    fromName: process.env.EMAIL_FROM_NAME ?? 'ZeroAuth',
  },
} as const;
