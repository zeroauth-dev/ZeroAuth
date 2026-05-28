/**
 * Dashboard-side audit-integrity API client (precursor to C-123, sprint 2).
 *
 * Single function: `checkAuditIntegrity(tenantId, environment?)`. Hits
 * `GET /api/admin/audit-integrity?tenant_id=<>&environment=<>` and maps
 * the server response into the dashboard's `IntegrityResult` discriminated
 * union (defined in `components/IntegrityCheckCard.tsx`).
 *
 * Contracts the rest of the dashboard relies on:
 *
 * 1. **No PII on the wire or in the type.** The audit-integrity endpoint
 *    returns `{ status, tenantId, environment, brokenAt?, reason?, ... }`.
 *    There is no `user`, no `event_data`, no `actor_*` field on the
 *    response shape. The dashboard never sees row-level audit content
 *    from this client — only metadata about chain integrity.
 *
 * 2. **`lastChecked` is computed client-side.** The server returns a pass
 *    or fail verdict but no canonical timestamp; the client stamps the
 *    moment the response arrives. C-123 may revisit this if the server
 *    starts returning the chain head's `created_at`, but for the
 *    skeleton an `ISOString` on the client is sufficient (Scene 5 of
 *    the bank demo cares about "panel transitions to red", not about
 *    a server-attested verification time).
 *
 * 3. **`rowsChecked` is derived from `limit`.** The server replays up to
 *    `limit` rows and either reports a `brokenAt` row id or a pass. The
 *    client treats `limit` as the upper-bound row count on PASS. C-123
 *    is the right place to add a true `rowsChecked` field to the
 *    server response if Phase 1 demands exact counts.
 *
 * 4. **All requests go to `/api/admin/audit-integrity`.** The endpoint
 *    is admin-gated by `x-api-key` in `src/middleware/auth.ts`. The
 *    dashboard's wiring path (C-123) is responsible for attaching the
 *    correct credential; this client sends both `Authorization: Bearer
 *    <jwt>` (matching the rest of the dashboard) AND an `x-api-key`
 *    header when one is present in `localStorage` under the
 *    `zeroauth.admin_api_key` key. This is a temporary skeleton-only
 *    shape; C-123 will replace it with a console-proxied path.
 *
 * Demo Scene 5 reference: `docs/plan/bfsi-v1/02-bank-demo.md` — the
 * operator clicks "Re-run check" and the dashboard fires this client.
 */

import { getToken } from './api';
import type { IntegrityResult } from '../components/IntegrityCheckCard';

// ─── Wire shape ──────────────────────────────────────────────────
//
// What the server sends today. Mirrors `src/routes/admin.ts::/audit-integrity`.
// Anything off the wire that is not in this shape is dropped on the floor
// by the mapper below — defence in depth against an upstream that starts
// sending PII it should not.

interface PassWire {
  status: 'pass';
  tenantId: string;
  environment: 'live' | 'test' | null;
  startId?: string;
  limit?: number;
}

interface FailWire {
  status: 'fail';
  tenantId: string;
  environment: 'live' | 'test' | null;
  brokenAt: string | number;
  reason: string;
}

type WireResponse = PassWire | FailWire;

// ─── Public API ──────────────────────────────────────────────────

/**
 * Run an audit-integrity check for a single tenant.
 *
 * @param tenantId    UUID of the tenant whose chain to verify.
 * @param environment optional 'live' | 'test'; omitted means both.
 * @returns           an `IntegrityResult` (never the 'pending' variant —
 *                    pending is a UI-only state the consumer emits while
 *                    the promise is in-flight).
 */
export async function checkAuditIntegrity(
  tenantId: string,
  environment?: 'live' | 'test',
): Promise<IntegrityResult> {
  const url = new URL('/api/admin/audit-integrity', window.location.origin);
  url.searchParams.set('tenant_id', tenantId);
  if (environment) {
    url.searchParams.set('environment', environment);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const adminKey = readAdminKey();
  if (adminKey) headers['x-api-key'] = adminKey;

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    throw new Error(`checkAuditIntegrity failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as WireResponse;
  const lastChecked = new Date().toISOString();

  if (body.status === 'pass') {
    const limit = typeof body.limit === 'number' && body.limit > 0 ? body.limit : 0;
    return {
      status: 'pass',
      tenantId: String(body.tenantId ?? tenantId),
      environment: body.environment ?? environment ?? null,
      rowsChecked: limit,
      lastChecked,
    };
  }
  if (body.status === 'fail') {
    return {
      status: 'fail',
      tenantId: String(body.tenantId ?? tenantId),
      environment: body.environment ?? environment ?? null,
      brokenAt: String(body.brokenAt ?? '?'),
      reason: typeof body.reason === 'string' ? body.reason : 'Unknown integrity failure.',
      lastChecked,
    };
  }
  throw new Error('checkAuditIntegrity: unrecognised server status');
}

// ─── Admin-key helper ────────────────────────────────────────────
//
// Skeleton-only: read an optional admin key out of localStorage. C-123
// removes this in favour of a server-side proxy. We deliberately do not
// throw if it's missing — the JWT path is the primary credential, and a
// missing admin key just yields a 401 from the server which the consumer
// surfaces as a generic error.

const ADMIN_KEY_STORAGE = 'zeroauth.admin_api_key';

function readAdminKey(): string | null {
  try {
    return localStorage.getItem(ADMIN_KEY_STORAGE);
  } catch {
    return null;
  }
}
