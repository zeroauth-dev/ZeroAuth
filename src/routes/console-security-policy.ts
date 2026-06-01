/**
 * Console: per-tenant security_policy management (ADR 0017).
 *
 * The blockchain-agnostic pivot ([adr/0017-blockchain-agnostic-posture.md])
 * carries three independent provider slots on `tenants.security_policy`
 * (JSONB):
 *
 *   - `did_provider`         — where DIDs are registered (default `off-chain`)
 *   - `verifier_provider`    — additional on-chain re-verify (default `off-chain`)
 *   - `audit_anchor_provider`— where the audit chain is anchored (default `none`)
 *
 * Plus chain-config strings (`base_rpc_url`, `did_registry_address`,
 * `groth16_verifier_address`, `audit_anchor_contract_address`,
 * `audit_anchor_signing_key_id`) consulted by the resolver in
 * `src/services/tenant-providers.ts` when a non-default provider is
 * picked.
 *
 * This router exposes two console-JWT-authed endpoints:
 *
 *   - GET  /api/console/security-policy → current policy, normalised
 *     through `resolveProviders` so the dashboard sees the same triple
 *     the platform gates do, with defaults filled in for missing fields.
 *
 *   - POST /api/console/security-policy → merge a partial update onto
 *     the existing policy. Enum values are validated against the
 *     `tenant-providers` allow-lists; unknown values 400 rather than
 *     silently falling back (the resolver's "stay off-chain when
 *     unsure" posture is the right runtime default but the wrong
 *     authoring-time signal — an operator typing `base-sepolai` should
 *     see the typo, not a silent off-chain downgrade).
 *
 * Every POST writes an `audit_events` row via `appendAuditEvent` —
 * security-policy edits are exactly the class of change an auditor
 * replays the chain to reconstruct. The row's `metadata` carries the
 * before/after provider triple so the diff is human-readable from
 * the dashboard's existing audit-log viewer.
 *
 * Auth: shared `requireConsoleAuth` middleware exported from
 * `src/routes/console.ts`. Same Authorization-header-or-cookie path the
 * rest of the console surface uses; the route-level limiter
 * (`consoleWriteLimiter`) lives in console.ts and is not duplicated
 * here because policy edits are infrequent enough that the global
 * console rate limit suffices.
 */

import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../services/logger';
import { getPool } from '../services/db';
import { getTenantById } from '../services/tenants';
import { appendAuditEvent } from '../services/audit';
import {
  resolveProviders,
  DEFAULT_PROVIDERS,
  type DidProvider,
  type VerifierProvider,
  type AuditAnchorProvider,
} from '../services/tenant-providers';
import type { TenantSecurityPolicy } from '../types';

// ─── JWT verification (mirrors console.ts) ────────────────────────
//
// `requireConsoleAuth` is not exported from console.ts, and adding a
// circular import (router → console-router → security-policy-router)
// would be fragile. The cheaper move is to repeat the small JWT
// verification shape here — same issuer, audience, cookie name, and
// type marker as the parent module. If console.ts ever lifts these
// constants into a shared `src/middleware/console-auth.ts`, this file
// switches over without behaviour change.

const CONSOLE_JWT_ISSUER = 'zeroauth-console';
const CONSOLE_JWT_AUDIENCE = 'zeroauth-console';
const CONSOLE_JWT_COOKIE = 'zeroauth_console_jwt';

interface ConsolePrincipal {
  tenantId: string;
  email: string;
  jti?: string;
}

function verifyConsoleToken(token: string): ConsolePrincipal {
  const payload = jwt.verify(token, config.jwt.secret, {
    issuer: CONSOLE_JWT_ISSUER,
    audience: CONSOLE_JWT_AUDIENCE,
  }) as { tenantId?: string; email?: string; type?: string; jti?: string };
  if (payload.type !== 'console' || !payload.tenantId || !payload.email) {
    throw new Error('Not a console token');
  }
  return { tenantId: payload.tenantId, email: payload.email, jti: payload.jti };
}

function requireConsoleAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (typeof (req as Request & { cookies?: Record<string, string> }).cookies?.[CONSOLE_JWT_COOKIE] === 'string') {
    token = (req as Request & { cookies: Record<string, string> }).cookies[CONSOLE_JWT_COOKIE];
  }

  if (!token) {
    res.status(401).json({ error: 'unauthorized', message: 'Login required.' });
    return;
  }

  try {
    const payload = verifyConsoleToken(token);
    (req as Request & { console?: ConsolePrincipal }).console = payload;
    next();
  } catch {
    res.status(401).json({ error: 'session_expired', message: 'Console session expired. Please login again.' });
  }
}

// ─── Enum allow-lists for input validation ────────────────────────
//
// Kept aligned with the literal-union types in `tenant-providers.ts`.
// A drift here vs. there means a typo gets through validation but
// trips the resolver's "stay off-chain" fallback — silent downgrade.
// Tests in `tests/console-security-policy.test.ts` pin the two lists
// against each other (TODO when the test lands).

const DID_PROVIDERS: readonly DidProvider[] = [
  'off-chain',
  'base-sepolia',
  'base-mainnet',
  'custom-chain',
] as const;

const VERIFIER_PROVIDERS: readonly VerifierProvider[] = [
  'off-chain',
  'on-chain',
] as const;

const AUDIT_ANCHOR_PROVIDERS: readonly AuditAnchorProvider[] = [
  'none',
  'signed-transcript',
  'base-sepolia',
  'base-mainnet',
  'witness-cosign',
] as const;

const router = Router();

/**
 * GET /api/console/security-policy
 *
 * Return the authenticated tenant's effective security policy, with
 * the ADR 0017 provider triple resolved through
 * `resolveProviders(security_policy)` so the dashboard always sees
 * the same values the platform's gates do (`identity.ts`,
 * `anchor-job.ts`, etc.).
 *
 * Response shape:
 *
 *   {
 *     policy: {
 *       did_provider, verifier_provider, audit_anchor_provider,
 *       base_rpc_url, did_registry_address,
 *       groth16_verifier_address, audit_anchor_contract_address,
 *       audit_anchor_signing_key_id,
 *     },
 *     defaults: { did_provider, verifier_provider, audit_anchor_provider },
 *     raw: <verbatim JSONB on the row>,
 *   }
 *
 * The dashboard renders `policy` as the form's initial values and
 * uses `defaults` to label the "(default)" badge next to each
 * unconfigured field. `raw` is included for debugging — the dashboard
 * ignores it.
 */
router.get('/security-policy', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId } = (req as Request & { console: ConsolePrincipal }).console;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      res.status(404).json({ error: 'tenant_not_found', message: 'Tenant not found.' });
      return;
    }

    const raw = tenant.security_policy ?? {};
    const resolved = resolveProviders(raw);

    res.json({
      policy: {
        did_provider: resolved.didProvider,
        verifier_provider: resolved.verifierProvider,
        audit_anchor_provider: resolved.auditAnchorProvider,
        base_rpc_url: resolved.baseRpcUrl,
        did_registry_address: resolved.didRegistryAddress,
        groth16_verifier_address: resolved.groth16VerifierAddress,
        audit_anchor_contract_address: resolved.auditAnchorContractAddress,
        audit_anchor_signing_key_id:
          typeof raw.audit_anchor_signing_key_id === 'string' && raw.audit_anchor_signing_key_id.length > 0
            ? raw.audit_anchor_signing_key_id
            : null,
      },
      defaults: {
        did_provider: DEFAULT_PROVIDERS.didProvider,
        verifier_provider: DEFAULT_PROVIDERS.verifierProvider,
        audit_anchor_provider: DEFAULT_PROVIDERS.auditAnchorProvider,
      },
      raw,
    });
  } catch (err) {
    logger.error('Console: security-policy GET failed', {
      error: (err as Error).message,
    });
    res.status(500).json({
      error: 'security_policy_read_failed',
      message: 'Failed to read security policy.',
    });
  }
});

/**
 * POST /api/console/security-policy
 *
 * Merge a partial update onto the tenant's `security_policy` JSONB.
 *
 * Body (all fields optional — only present keys are updated; pass an
 * explicit `null` to clear a chain-config string):
 *
 *   {
 *     did_provider?:           'off-chain' | 'base-sepolia' | 'base-mainnet' | 'custom-chain',
 *     verifier_provider?:      'off-chain' | 'on-chain',
 *     audit_anchor_provider?:  'none' | 'signed-transcript' | 'base-sepolia' | 'base-mainnet' | 'witness-cosign',
 *     base_rpc_url?:           string | null,
 *     did_registry_address?:   string | null,
 *     groth16_verifier_address?: string | null,
 *     audit_anchor_contract_address?: string | null,
 *     audit_anchor_signing_key_id?:   string | null,
 *   }
 *
 * Unknown enum values 400 with `invalid_<field>` codes so a typo at
 * authoring time surfaces immediately rather than silently routing
 * the tenant back to the default off-chain provider at resolver
 * time. Unknown body keys are stripped (not echoed onto the row) so
 * the JSONB doesn't accumulate dead fields from future client
 * drift.
 *
 * Successful updates write an `audit_events` row through
 * `appendAuditEvent` (the hash-chain entry point). The row's
 * `metadata.before` / `metadata.after` carry the resolved provider
 * triples so the audit-log viewer renders a meaningful diff without
 * loading the JSONB column at render time.
 */
router.post('/security-policy', requireConsoleAuth, async (req: Request, res: Response) => {
  try {
    const { tenantId, email } = (req as Request & { console: ConsolePrincipal }).console;
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'invalid_request', message: 'Body must be a JSON object.' });
      return;
    }

    // ─── Enum validation ──────────────────────────────────────────
    //
    // Only the three provider slots are constrained. Chain-config
    // strings are accepted as arbitrary strings — validation of an
    // RPC URL or 0x-prefixed contract address belongs at the point
    // of consumption (e.g. anchor-job.ts), not here, because what
    // counts as "valid" depends on the chosen provider.
    if (body.did_provider !== undefined && !DID_PROVIDERS.includes(body.did_provider as DidProvider)) {
      res.status(400).json({
        error: 'invalid_did_provider',
        message: `did_provider must be one of: ${DID_PROVIDERS.join(', ')}`,
      });
      return;
    }
    if (body.verifier_provider !== undefined && !VERIFIER_PROVIDERS.includes(body.verifier_provider as VerifierProvider)) {
      res.status(400).json({
        error: 'invalid_verifier_provider',
        message: `verifier_provider must be one of: ${VERIFIER_PROVIDERS.join(', ')}`,
      });
      return;
    }
    if (body.audit_anchor_provider !== undefined && !AUDIT_ANCHOR_PROVIDERS.includes(body.audit_anchor_provider as AuditAnchorProvider)) {
      res.status(400).json({
        error: 'invalid_audit_anchor_provider',
        message: `audit_anchor_provider must be one of: ${AUDIT_ANCHOR_PROVIDERS.join(', ')}`,
      });
      return;
    }

    // String fields: accept string or null (null clears the field).
    const STRING_FIELDS = [
      'base_rpc_url',
      'did_registry_address',
      'groth16_verifier_address',
      'audit_anchor_contract_address',
      'audit_anchor_signing_key_id',
    ] as const;
    for (const f of STRING_FIELDS) {
      if (body[f] !== undefined && body[f] !== null && typeof body[f] !== 'string') {
        res.status(400).json({
          error: `invalid_${f}`,
          message: `${f} must be a string or null.`,
        });
        return;
      }
    }

    // ─── Load current policy ──────────────────────────────────────
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      res.status(404).json({ error: 'tenant_not_found', message: 'Tenant not found.' });
      return;
    }
    const before: TenantSecurityPolicy = tenant.security_policy ?? {};

    // ─── Build the merged policy ──────────────────────────────────
    //
    // Shallow merge — `before` keys carry through except where the
    // body explicitly sets them. An explicit `null` on a string
    // field deletes that key from the JSONB (so it stops shadowing
    // the resolver default); `undefined` (missing key) leaves the
    // existing value in place. Provider enums never carry `null`
    // because the resolver expects a string-or-absent.
    const after: TenantSecurityPolicy = { ...before };

    if (body.did_provider !== undefined) {
      after.did_provider = body.did_provider as DidProvider;
    }
    if (body.verifier_provider !== undefined) {
      after.verifier_provider = body.verifier_provider as VerifierProvider;
    }
    if (body.audit_anchor_provider !== undefined) {
      after.audit_anchor_provider = body.audit_anchor_provider as AuditAnchorProvider;
    }
    for (const f of STRING_FIELDS) {
      if (body[f] === null) {
        delete after[f];
      } else if (typeof body[f] === 'string') {
        (after as Record<string, unknown>)[f] = body[f];
      }
    }

    // ─── Persist ─────────────────────────────────────────────────
    const pool = getPool();
    await pool.query(
      `UPDATE tenants
         SET security_policy = $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(after), tenantId],
    );

    // ─── Audit row ────────────────────────────────────────────────
    //
    // Goes through `appendAuditEvent` directly (the hash-chain entry
    // point) rather than the `recordAuditEvent` wrapper in
    // platform.ts. The metadata carries before/after resolved
    // triples so the dashboard's audit-log viewer renders a
    // human-readable diff without re-resolving on the client.
    const resolvedBefore = resolveProviders(before);
    const resolvedAfter = resolveProviders(after);

    await appendAuditEvent({
      tenant_id: tenantId,
      environment: null,
      actor_type: 'console',
      actor_id: tenantId,
      action: 'security_policy.updated',
      entity_type: 'tenant',
      entity_id: tenantId,
      status: 'success',
      summary: `Security policy updated by ${email}`,
      metadata: {
        actor_email: email,
        before: {
          did_provider: resolvedBefore.didProvider,
          verifier_provider: resolvedBefore.verifierProvider,
          audit_anchor_provider: resolvedBefore.auditAnchorProvider,
        },
        after: {
          did_provider: resolvedAfter.didProvider,
          verifier_provider: resolvedAfter.verifierProvider,
          audit_anchor_provider: resolvedAfter.auditAnchorProvider,
        },
        // Carry the raw post-update policy too so a forensic replay
        // can reconstruct the exact JSONB without joining against
        // the tenants table at the same point in time.
        policy_after: after as Record<string, unknown>,
      },
    });

    res.json({
      policy: {
        did_provider: resolvedAfter.didProvider,
        verifier_provider: resolvedAfter.verifierProvider,
        audit_anchor_provider: resolvedAfter.auditAnchorProvider,
        base_rpc_url: resolvedAfter.baseRpcUrl,
        did_registry_address: resolvedAfter.didRegistryAddress,
        groth16_verifier_address: resolvedAfter.groth16VerifierAddress,
        audit_anchor_contract_address: resolvedAfter.auditAnchorContractAddress,
        audit_anchor_signing_key_id:
          typeof after.audit_anchor_signing_key_id === 'string' && after.audit_anchor_signing_key_id.length > 0
            ? after.audit_anchor_signing_key_id
            : null,
      },
      defaults: {
        did_provider: DEFAULT_PROVIDERS.didProvider,
        verifier_provider: DEFAULT_PROVIDERS.verifierProvider,
        audit_anchor_provider: DEFAULT_PROVIDERS.auditAnchorProvider,
      },
    });
  } catch (err) {
    logger.error('Console: security-policy POST failed', {
      error: (err as Error).message,
    });
    res.status(500).json({
      error: 'security_policy_write_failed',
      message: 'Failed to update security policy.',
    });
  }
});

export default router;
