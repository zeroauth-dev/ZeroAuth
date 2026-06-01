/**
 * Dashboard-side security-policy API client (ADR 0017).
 *
 * Talks to the console proxy at `/api/console/security-policy`. The
 * proxy reads (`GET`) and writes (`POST`) the three blockchain-agnostic
 * provider slots from `tenants.security_policy` JSONB:
 *
 *   - `did_provider`           — where DIDs are registered.
 *   - `verifier_provider`      — whether to re-verify proofs on-chain.
 *   - `audit_anchor_provider`  — where the audit hash chain is anchored.
 *
 * Defaults (off-chain across the board) mirror the server-side resolver
 * in `src/services/tenant-providers.ts`. A tenant that has never opened
 * the security-policy page renders the three defaults selected.
 *
 * Contracts this client enforces:
 *
 *   1. **Whitelist of provider values.** The dropdowns in
 *      `routes/tenant/security-policy.tsx` only emit the literal values
 *      below. The server-side resolver already validates and falls back
 *      to the default when an unknown value lands, but the client layer
 *      narrows the wire shape so the consumer cannot accidentally POST a
 *      typo. Mirrors `src/services/tenant-providers.ts` exactly.
 *
 *   2. **Read-modify-write on POST.** The server's security_policy JSONB
 *      carries fields that have nothing to do with the three providers
 *      this page edits (Play Integrity knobs, allowed_origins, etc).
 *      The proxy on the server side performs the merge — this client
 *      only ever sends the three provider fields, so a stale tenant row
 *      whose `allowed_origins` we never round-tripped is preserved.
 *
 *   3. **No PII on the wire.** The security_policy surface carries
 *      provider strings + a small set of opaque addresses (RPC URL,
 *      contract addresses, signing-key id). No user data, no
 *      commitments, no biometric-derived material ever flows through
 *      this surface.
 *
 * Source-of-truth pointers:
 *   - ADR 0017 — `adr/0017-blockchain-agnostic-posture.md`
 *   - Server resolver — `src/services/tenant-providers.ts`
 *   - Type definition — `src/types/index.ts::TenantSecurityPolicy`
 */

import { ApiError, getToken } from './api';

// ─── Provider unions ─────────────────────────────────────────────
//
// These must stay in lock-step with `src/services/tenant-providers.ts`.
// A mismatch is caught at typecheck time when the consuming component
// imports `DID_PROVIDERS` and assigns it to a `<select>` whose
// `onChange` is typed against `DidProvider`.

export type DidProvider =
  | 'off-chain'
  | 'base-sepolia'
  | 'base-mainnet'
  | 'custom-chain';

export type VerifierProvider = 'off-chain' | 'on-chain';

export type AuditAnchorProvider =
  | 'none'
  | 'signed-transcript'
  | 'base-sepolia'
  | 'base-mainnet'
  | 'witness-cosign';

export const DID_PROVIDERS: readonly DidProvider[] = [
  'off-chain',
  'base-sepolia',
  'base-mainnet',
  'custom-chain',
] as const;

export const VERIFIER_PROVIDERS: readonly VerifierProvider[] = [
  'off-chain',
  'on-chain',
] as const;

export const AUDIT_ANCHOR_PROVIDERS: readonly AuditAnchorProvider[] = [
  'none',
  'signed-transcript',
  'base-sepolia',
  'base-mainnet',
  'witness-cosign',
] as const;

// ─── Public shape ────────────────────────────────────────────────

/**
 * The slice of `security_policy` the dashboard edits. The server proxy
 * accepts and returns exactly these three fields; everything else on
 * the tenant's `security_policy` JSONB is preserved server-side and
 * never exposed here.
 */
export interface SecurityPolicy {
  didProvider: DidProvider;
  verifierProvider: VerifierProvider;
  auditAnchorProvider: AuditAnchorProvider;
}

/**
 * Defaults the dashboard renders when the server returns an empty
 * `security_policy` (a fresh tenant that has never opened this page).
 * Off-chain across the board to mirror `DEFAULT_PROVIDERS` in
 * `src/services/tenant-providers.ts`.
 */
export const DEFAULT_POLICY: Readonly<SecurityPolicy> = Object.freeze({
  didProvider: 'off-chain',
  verifierProvider: 'off-chain',
  auditAnchorProvider: 'none',
});

// ─── Wire shape ──────────────────────────────────────────────────
//
// What the server sends / accepts on the console proxy. snake_case on
// the wire, camelCase in the dashboard. The mapper below is the only
// place these two conventions meet.

interface WirePolicy {
  did_provider?: string | null;
  verifier_provider?: string | null;
  audit_anchor_provider?: string | null;
}

function pickDidProvider(raw: unknown): DidProvider {
  return DID_PROVIDERS.includes(raw as DidProvider)
    ? (raw as DidProvider)
    : DEFAULT_POLICY.didProvider;
}

function pickVerifierProvider(raw: unknown): VerifierProvider {
  return VERIFIER_PROVIDERS.includes(raw as VerifierProvider)
    ? (raw as VerifierProvider)
    : DEFAULT_POLICY.verifierProvider;
}

function pickAuditAnchorProvider(raw: unknown): AuditAnchorProvider {
  return AUDIT_ANCHOR_PROVIDERS.includes(raw as AuditAnchorProvider)
    ? (raw as AuditAnchorProvider)
    : DEFAULT_POLICY.auditAnchorProvider;
}

function fromWire(body: WirePolicy | null | undefined): SecurityPolicy {
  if (!body || typeof body !== 'object') return { ...DEFAULT_POLICY };
  return {
    didProvider: pickDidProvider(body.did_provider),
    verifierProvider: pickVerifierProvider(body.verifier_provider),
    auditAnchorProvider: pickAuditAnchorProvider(body.audit_anchor_provider),
  };
}

function toWire(policy: SecurityPolicy): WirePolicy {
  return {
    did_provider: policy.didProvider,
    verifier_provider: policy.verifierProvider,
    audit_anchor_provider: policy.auditAnchorProvider,
  };
}

// ─── Fetch helpers ───────────────────────────────────────────────
//
// We don't reuse `request` from `./api.ts` here because that helper
// always serialises JSON via `JSON.stringify` and we want a tiny,
// auditable surface for the security-policy round-trip. The auth path
// (Bearer JWT from localStorage) and the 401-on-stale-token semantics
// are the same.

const ENDPOINT = '/api/console/security-policy';

interface ServerEnvelope {
  policy?: WirePolicy;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function envelopeToPolicy(body: unknown): SecurityPolicy {
  if (body && typeof body === 'object' && 'policy' in body) {
    return fromWire((body as ServerEnvelope).policy);
  }
  // Backwards compat: accept the bare policy shape too in case the
  // server proxy is rolled out without the envelope. The mapper falls
  // back to defaults for unknown values so a malformed body still
  // produces a renderable page.
  return fromWire(body as WirePolicy);
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * GET `/api/console/security-policy`. Returns the three-provider slice
 * of the tenant's `security_policy` JSONB. A tenant that has never
 * saved a policy renders the three platform defaults.
 *
 * Throws `ApiError` on any non-2xx; consumers wrap this in TanStack
 * Query, which surfaces the error via `query.error`.
 */
export async function getSecurityPolicy(): Promise<SecurityPolicy> {
  const res = await fetch(ENDPOINT, {
    method: 'GET',
    headers: buildHeaders(),
  });
  const body = await readJson(res);
  if (!res.ok) {
    const errBody = (body && typeof body === 'object' ? body : {}) as {
      error?: string;
      message?: string;
    };
    throw new ApiError(
      res.status,
      errBody.error ?? `http_${res.status}`,
      errBody.message ?? res.statusText ?? 'Failed to load security policy.',
      body,
    );
  }
  return envelopeToPolicy(body);
}

/**
 * POST `/api/console/security-policy`. Server merges the three provider
 * fields into the tenant's existing `security_policy` JSONB and returns
 * the post-merge slice. Caller mirrors that into the form state so a
 * server-side defaulting (e.g. an unknown value the server rejected)
 * is visible to the operator.
 *
 * Returns the post-merge `SecurityPolicy`. Throws `ApiError` on any
 * non-2xx.
 */
export async function updateSecurityPolicy(
  policy: SecurityPolicy,
): Promise<SecurityPolicy> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(toWire(policy)),
  });
  const body = await readJson(res);
  if (!res.ok) {
    const errBody = (body && typeof body === 'object' ? body : {}) as {
      error?: string;
      message?: string;
    };
    throw new ApiError(
      res.status,
      errBody.error ?? `http_${res.status}`,
      errBody.message ?? res.statusText ?? 'Failed to save security policy.',
      body,
    );
  }
  return envelopeToPolicy(body);
}
