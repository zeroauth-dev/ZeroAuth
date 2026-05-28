/**
 * Dashboard-side users-list API client (precursor to C-107, sprint 1).
 *
 * Two contracts the rest of the dashboard relies on:
 *
 * 1. **`TenantUserRow` is a structural blacklist of PII.** This type
 *    carries ONLY `id`, `did`, `commitment`, `tenantId`, `environment`,
 *    `createdAt`. There is no `full_name`, no `email`, no `phone`, no
 *    `employee_code`. A component that imports `TenantUserRow` and
 *    tries to read `.full_name` off it will not compile.
 *
 *    NOTE — this is the **dashboard-side type, not the server-side
 *    type**. The server's `tenant_users` table today carries PII
 *    columns (`full_name`, `email`, `phone`, `employee_code`); the
 *    Phase 0 schema-purity test (`tests/schema-purity.test.ts`) pins
 *    the current PG schema so no NEW PII columns sneak in. The Phase
 *    1 PII-strip migration that follows C-107 will remove the columns
 *    on the server side. Until then, this client is responsible for
 *    stripping them on the way out so the dashboard never sees PII at
 *    all — defence in depth.
 *
 * 2. **The strip is enforced by an allowlist projection.** `listUsers`
 *    explicitly picks the six allowed fields off whatever the server
 *    returns. Object-spread tricks, `as any`, and `keyof` reads of the
 *    server's response shape are all banned in this file. The test
 *    suite at `routes/tenant/__tests__/users.test.tsx` greps this file
 *    AND the consuming component for the forbidden field reads.
 *
 * Read the demo Scene 1 expectation in `docs/plan/bfsi-v1/02-bank-demo.md`:
 * "Operator clicks the row: only `did`, `commitment_hex`, `created_at`,
 *  `tenant_id`, `enrollment_audit_id`. No name, no face image, no
 *  fingerprint, no email, no PAN, no Aadhaar number." This file is
 *  the place where "no name, no email, no phone" is enforced for the
 *  dashboard surface — the server-side PII strip is C-107's other
 *  half (owned by Agent #7).
 *
 * DPDP §2(t) memo skeleton — the legal memo we co-author with external
 * counsel argues that the data in this table is not "personal data"
 * because the data principal is not identifiable by or in relation to
 * a Poseidon commitment + opaque DID. The type below is the engineering-
 * side commitment to that legal posture: the dashboard cannot accidentally
 * widen the surface area.
 */

import { getToken } from './api';

// ─── Public type ─────────────────────────────────────────────────

/**
 * The ONLY shape the dashboard ever sees for a tenant user.
 *
 * Adding a field here is an ADR-grade decision — every additional
 * surface is a DPDP §2(t) review item.
 */
export interface TenantUserRow {
  /** Internal opaque row id; not derived from any PII. */
  id: string;
  /** Decentralized identifier — opaque, deterministic from commitment. */
  did: string;
  /**
   * Poseidon commitment as a hex-encoded field element. The CISO
   * cannot identify a customer from this value (DPDP §2(t) argument).
   */
  commitment: string;
  /** Tenant scope — the user's tenant id. */
  tenantId: string;
  /** Environment scope — `live` vs `test`. */
  environment: 'live' | 'test';
  /** ISO-8601 enrollment timestamp. */
  createdAt: string;
}

// ─── Wire shape ──────────────────────────────────────────────────
//
// What the server sends today. Wider than `TenantUserRow` on purpose —
// the strip below narrows it. `unknown` would be safer still, but a
// loose record lets the projection read fields by name without a cast.
//
// Forbidden fields are not listed here at all; if they appear on the
// wire they fall through the `pickAllowed` allowlist and never reach
// the component layer.

interface ServerUserRow {
  id: string;
  did?: string | null;
  commitment?: string | null;
  tenant_id?: string;
  tenantId?: string;
  environment?: 'live' | 'test';
  created_at?: string;
  createdAt?: string;
  // Anything else the server sends is dropped on the floor.
  [extra: string]: unknown;
}

interface ServerListResponse {
  users: ServerUserRow[];
  nextCursor?: string;
}

// ─── Projection ──────────────────────────────────────────────────
//
// Hand-written allowlist projection. Six fields in, six fields out.
// If a field is missing on the wire, we emit the empty string for the
// strings and leave `environment` defaulting to 'live'. The component
// renders dashes for blanks so this never produces UI that looks
// authoritative when the upstream is broken.

function pickAllowed(row: ServerUserRow): TenantUserRow {
  return {
    id: String(row.id),
    did: typeof row.did === 'string' ? row.did : '',
    commitment: typeof row.commitment === 'string' ? row.commitment : '',
    tenantId: typeof row.tenantId === 'string'
      ? row.tenantId
      : typeof row.tenant_id === 'string'
        ? row.tenant_id
        : '',
    environment: row.environment === 'test' ? 'test' : 'live',
    createdAt: typeof row.createdAt === 'string'
      ? row.createdAt
      : typeof row.created_at === 'string'
        ? row.created_at
        : '',
  };
}

// ─── Public API ──────────────────────────────────────────────────

export interface ListUsersOpts {
  cursor?: string;
  limit?: number;
}

export interface ListUsersResult {
  users: TenantUserRow[];
  nextCursor?: string;
}

/**
 * GET /api/console/users — cursor-paginated.
 *
 * The server today returns the full PII-carrying row (see
 * `dashboard/src/lib/api.ts::User` for the legacy wire shape). This
 * client deliberately throws those fields away. The component layer
 * only ever sees `TenantUserRow`s.
 *
 * The `cursor` + `limit` query-string contract matches the API
 * contract draft for C-107 (see `docs/api_contract.md` once C-107
 * sprint 1 lands the endpoint version of this).
 */
export async function listUsers(opts: ListUsersOpts = {}): Promise<ListUsersResult> {
  const url = new URL('/api/console/users', window.location.origin);
  if (opts.cursor) url.searchParams.set('cursor', opts.cursor);
  if (typeof opts.limit === 'number') url.searchParams.set('limit', String(opts.limit));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers,
  });

  if (!res.ok) {
    // Surface a minimal Error; the consumer-side react-query will
    // expose it via `error.message`. We deliberately don't dig the
    // server JSON for nested PII — even an error response is
    // suspect for a no-PII surface.
    throw new Error(`listUsers failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as ServerListResponse;
  const rows = Array.isArray(body.users) ? body.users : [];
  const users: TenantUserRow[] = rows.map(pickAllowed);
  return {
    users,
    ...(body.nextCursor ? { nextCursor: body.nextCursor } : {}),
  };
}
