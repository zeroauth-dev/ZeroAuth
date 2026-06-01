/**
 * Per-tenant compliance evidence pack — render service.
 *
 * Pulled by the bank's GC / RBI inspector via
 * `/api/console/compliance/evidence-pack`. Four blocks, each
 * independently verifiable: `markdown` cover letter,
 * `hashChainSnapshot` (head+tail of `audit_events`), `integrity`
 * (full `verifyAuditChain` replay verdict), `dpdp2tMemo` (verbatim
 * body of `docs/compliance/dpdp-2t-commitments-memo-v0.md`).
 *
 * Pure modulo DB + filesystem reads. No mutation, no outbound HTTP.
 * Audit-of-the-audit is the route layer's job.
 *
 * Not signed in v0; trust rides on TLS + console JWT. Schema is
 * additive so a future detached-HMAC v1 stays backward-compatible.
 */

import fs from 'fs';
import path from 'path';
import { getPool } from './db';
import { logger } from './logger';
import { getTenantById } from './tenants';
import { verifyAuditChain } from './audit';
import { resolveProviders, type ResolvedProviders } from './tenant-providers';
import type { ApiKeyEnvironment } from '../types';

/**
 * Path to the DPDP §2(t) memo on disk. Resolved two parent dirs up so
 * the path is identical under `npm run dev` (tsx, `src/services/`) and
 * `node dist/server.js` (compiled, `dist/services/`).
 */
const DPDP_MEMO_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'compliance',
  'dpdp-2t-commitments-memo-v0.md',
);

/**
 * Sentinel returned in place of the memo body when the file is missing
 * from the deployment artefact (e.g. a slim image that drops `docs/`).
 * The pack still renders; the bank sees the placeholder and the
 * operator gets a logged warning.
 */
const DPDP_MEMO_MISSING =
  '# DPDP §2(t) memo unavailable\n\n' +
  'The DPDP §2(t) commitments memo could not be loaded from this ' +
  'deployment artefact. Contact the ZeroAuth operator (or fetch the ' +
  'memo directly from docs.zeroauth.dev/compliance/dpdp-2t) for the ' +
  'verbatim body.\n';

/** How many rows of the chain head + tail we embed. Keep small. */
const SNAPSHOT_ROW_LIMIT = 5;

/** Schema version. Bump on incompatible JSON shape changes. */
export const EVIDENCE_PACK_VERSION = '0.1.0';

export interface ChainSnapshotRow {
  id: string;
  created_at: string;
  action: string;
  status: 'success' | 'failure';
  entity_type: string;
  entity_id: string | null;
  summary: string;
  previous_hash: string | null;
  event_hash: string | null;
}

export interface ChainSnapshot {
  totalRows: number;
  /** Oldest rows first (chain root). */
  head: ChainSnapshotRow[];
  /** Newest rows last (chain tail). May overlap with head when total ≤ 2*LIMIT. */
  tail: ChainSnapshotRow[];
  /** The most recent `event_hash`, or `null` for an empty chain. */
  currentHead: string | null;
}

export interface IntegrityResult {
  ok: boolean;
  rowsChecked?: number;
  brokenAt?: string;
  reason?: string;
}

export interface EvidencePackTenantBlock {
  id: string;
  email: string;
  companyName: string | null;
  plan: string;
  status: string;
  createdAt: string;
}

export interface EvidencePackProvidersBlock {
  didProvider: ResolvedProviders['didProvider'];
  verifierProvider: ResolvedProviders['verifierProvider'];
  auditAnchorProvider: ResolvedProviders['auditAnchorProvider'];
  baseRpcUrl: string | null;
  didRegistryAddress: string | null;
  groth16VerifierAddress: string | null;
  auditAnchorContractAddress: string | null;
}

export interface EvidencePackCounts {
  auditEvents: number;
  verificationEvents: number;
  devices: number;
  users: number;
}

export interface EvidencePack {
  schemaVersion: string;
  generatedAt: string;
  environment: ApiKeyEnvironment;
  tenant: EvidencePackTenantBlock;
  providers: EvidencePackProvidersBlock;
  counts: EvidencePackCounts;
  hashChainSnapshot: ChainSnapshot;
  integrity: IntegrityResult;
  markdown: string;
  dpdp2tMemo: string;
}

/** Row shape pulled by the snapshot queries. */
interface AuditRowRaw {
  id: string;
  created_at: Date;
  action: string;
  status: 'success' | 'failure';
  entity_type: string;
  entity_id: string | null;
  summary: string;
  previous_hash: string | null;
  event_hash: string | null;
}

function toSnapshotRow(r: AuditRowRaw): ChainSnapshotRow {
  return {
    id: r.id,
    created_at: r.created_at.toISOString(),
    action: r.action,
    status: r.status,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    summary: r.summary,
    previous_hash: r.previous_hash,
    event_hash: r.event_hash,
  };
}

/**
 * Read the DPDP §2(t) memo body off disk. Missing file is logged and
 * swapped for the placeholder — never an exception, because the pack
 * should still render when only the memo is unavailable.
 */
function loadDpdp2tMemo(): string {
  try {
    return fs.readFileSync(DPDP_MEMO_PATH, 'utf8');
  } catch (err) {
    logger.warn('compliance: DPDP 2(t) memo not readable; embedding placeholder', {
      path: DPDP_MEMO_PATH,
      error: (err as Error).message,
    });
    return DPDP_MEMO_MISSING;
  }
}

/**
 * Fetch head + tail of a tenant's audit chain. Two cheap index scans
 * against `idx_audit_events_chain`. Empty chain returns empty arrays.
 */
async function fetchChainSnapshot(
  tenantId: string,
  environment: ApiKeyEnvironment,
): Promise<ChainSnapshot> {
  const pool = getPool();

  const countResult = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM audit_events
      WHERE tenant_id = $1 AND environment = $2`,
    [tenantId, environment],
  );
  const totalRows = parseInt(countResult.rows[0]?.n ?? '0', 10);

  if (totalRows === 0) {
    return { totalRows: 0, head: [], tail: [], currentHead: null };
  }

  const SNAPSHOT_COLS = `id::text AS id, created_at, action, status, entity_type,
                         entity_id, summary, previous_hash, event_hash`;

  const headResult = await pool.query<AuditRowRaw>(
    `SELECT ${SNAPSHOT_COLS}
       FROM audit_events
      WHERE tenant_id = $1 AND environment = $2
      ORDER BY id ASC
      LIMIT $3`,
    [tenantId, environment, SNAPSHOT_ROW_LIMIT],
  );
  const tailResult = await pool.query<AuditRowRaw>(
    `SELECT ${SNAPSHOT_COLS}
       FROM audit_events
      WHERE tenant_id = $1 AND environment = $2
      ORDER BY id DESC
      LIMIT $3`,
    [tenantId, environment, SNAPSHOT_ROW_LIMIT],
  );

  const head = headResult.rows.map(toSnapshotRow);
  const tail = tailResult.rows.slice().reverse().map(toSnapshotRow);
  const currentHead = tail[tail.length - 1]?.event_hash ?? null;

  return { totalRows, head, tail, currentHead };
}

/**
 * Four short COUNT(*)s in parallel for the cover letter. Each is a
 * single index probe; row counts are bounded by tenant lifetime usage.
 */
async function fetchCounts(
  tenantId: string,
  environment: ApiKeyEnvironment,
): Promise<EvidencePackCounts> {
  const pool = getPool();
  const COUNT = (table: string) =>
    pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM ${table}
        WHERE tenant_id = $1 AND environment = $2`,
      [tenantId, environment],
    );
  const [audit, verifications, devices, users] = await Promise.all([
    COUNT('audit_events'),
    COUNT('verification_events'),
    COUNT('devices'),
    COUNT('tenant_users'),
  ]);
  return {
    auditEvents: parseInt(audit.rows[0]?.n ?? '0', 10),
    verificationEvents: parseInt(verifications.rows[0]?.n ?? '0', 10),
    devices: parseInt(devices.rows[0]?.n ?? '0', 10),
    users: parseInt(users.rows[0]?.n ?? '0', 10),
  };
}

/**
 * Render the markdown cover letter. Plain ASCII so a regulator's
 * mail-archived PDF keeps the formatting. Cross-references point at
 * ADRs + audit-findings doc for one-click pivots into the source.
 */
function renderMarkdown(
  tenant: EvidencePackTenantBlock,
  environment: ApiKeyEnvironment,
  providers: EvidencePackProvidersBlock,
  counts: EvidencePackCounts,
  snapshot: ChainSnapshot,
  integrity: IntegrityResult,
  generatedAt: string,
): string {
  const optional = (label: string, value: string | null) =>
    value ? `- **${label}:** \`${value}\`` : null;

  const providerLines = [
    `- **DID provider:** \`${providers.didProvider}\``,
    `- **Verifier provider:** \`${providers.verifierProvider}\``,
    `- **Audit-anchor provider:** \`${providers.auditAnchorProvider}\``,
    optional('Base RPC URL', providers.baseRpcUrl),
    optional('DIDRegistry contract', providers.didRegistryAddress),
    optional('Groth16Verifier contract', providers.groth16VerifierAddress),
    optional('Audit-anchor contract', providers.auditAnchorContractAddress),
  ].filter((s): s is string => s !== null);

  const integrityFailLines = integrity.ok
    ? []
    : [
        `  - Broken at row id: \`${integrity.brokenAt ?? 'unknown'}\``,
        `  - Reason: ${integrity.reason ?? 'unknown'}`,
      ];

  return [
    `# ZeroAuth compliance evidence pack — ${tenant.companyName ?? tenant.email}`,
    '',
    `- **Tenant ID:** \`${tenant.id}\``,
    `- **Tenant email:** ${tenant.email}`,
    `- **Environment:** \`${environment}\``,
    `- **Plan:** ${tenant.plan}`,
    `- **Status:** ${tenant.status}`,
    `- **Tenant created:** ${tenant.createdAt}`,
    `- **Pack generated:** ${generatedAt}`,
    `- **Pack schema:** ${EVIDENCE_PACK_VERSION}`,
    '',
    '## Provider posture (ADR 0017)',
    '',
    ...providerLines,
    '',
    '## Counts',
    '',
    `- Audit events: **${counts.auditEvents}**`,
    `- Verification events: **${counts.verificationEvents}**`,
    `- Devices: **${counts.devices}**`,
    `- Tenant users: **${counts.users}**`,
    '',
    '## Audit hash chain (ADR 0013)',
    '',
    `- Total rows: **${snapshot.totalRows}**`,
    `- Current chain head (\`event_hash\`): \`${snapshot.currentHead ?? '(empty chain)'}\``,
    `- Replay verdict: **${integrity.ok ? 'PASS' : 'FAIL'}**`,
    ...integrityFailLines,
    '',
    'The chain is a per-tenant linked list where each row\'s `event_hash` is',
    '`SHA-256(canonical_json(event_data) || previous_hash)`. Row 1 carries',
    '`previous_hash = "genesis"`. Mutating any row breaks the chain at that',
    'row and at every row after it. Replay verification is callable directly',
    'against a Postgres dump via `verifyAuditChain` in `src/services/audit.ts`',
    '— no live ZeroAuth process required.',
    '',
    '## Cross-references',
    '',
    '- ADR 0013 — Audit hash chain construction.',
    '- ADR 0014 — Audit anchor (daily on-chain commitment of the head).',
    '- ADR 0015 — Circuit version lock + trusted-setup ceremony manifest.',
    '- ADR 0017 — Blockchain-agnostic posture (provider triple semantics).',
    '- `docs/threat_model.md` — attack surface enumeration (A-NN entries).',
    '- `docs/security/audit-findings.md` — Phase 0 audit findings tracker.',
    '- `docs/compliance/dpdp-2t-commitments-memo-v0.md` — DPDP §2(t) memo (embedded below).',
    '',
    '## How an auditor verifies this pack',
    '',
    '1. Take a Postgres dump of `audit_events` filtered by this `tenant_id` + `environment`.',
    '2. Replay the chain offline using `verifyAuditChain` from `src/services/audit.ts`.',
    '3. Confirm the final `event_hash` matches `hashChainSnapshot.currentHead` above.',
    '4. Spot-check the head and tail rows below against the `audit_events` table.',
    '5. Read the DPDP §2(t) memo for the legal posture on commitments and DIDs.',
    '',
  ].join('\n');
}

/**
 * Render a fresh evidence pack for `(tenantId, environment)`. Returns
 * a self-contained JSON object suitable for serialisation. Throws
 * `Error('tenant_not_found: <id>')` when the tenant does not exist —
 * caller renders 404. All other errors (memo read, chain replay)
 * degrade gracefully into pack fields.
 *
 * `verifyAuditChain` can be expensive on a long chain (one SHA-256 per
 * row). `chainLimit` caps the replay — default 100_000 rows matches
 * the admin endpoint ceiling.
 */
export async function renderCompliancePack(
  tenantId: string,
  environment: ApiKeyEnvironment,
  options: { chainLimit?: number } = {},
): Promise<EvidencePack> {
  const tenantRow = await getTenantById(tenantId);
  if (!tenantRow) {
    throw new Error(`tenant_not_found: ${tenantId}`);
  }

  const tenant: EvidencePackTenantBlock = {
    id: tenantRow.id,
    email: tenantRow.email,
    companyName: tenantRow.company_name,
    plan: tenantRow.plan,
    status: tenantRow.status,
    createdAt: tenantRow.created_at.toISOString(),
  };

  const resolved = resolveProviders(tenantRow.security_policy);
  const providers: EvidencePackProvidersBlock = {
    didProvider: resolved.didProvider,
    verifierProvider: resolved.verifierProvider,
    auditAnchorProvider: resolved.auditAnchorProvider,
    baseRpcUrl: resolved.baseRpcUrl,
    didRegistryAddress: resolved.didRegistryAddress,
    groth16VerifierAddress: resolved.groth16VerifierAddress,
    auditAnchorContractAddress: resolved.auditAnchorContractAddress,
  };

  const [counts, snapshot] = await Promise.all([
    fetchCounts(tenantId, environment),
    fetchChainSnapshot(tenantId, environment),
  ]);

  // Chain replay. A throw here would poison the whole pack — degrade
  // to an `ok: false` verdict with the reason so the bank still gets
  // the rest of the bundle.
  let integrity: IntegrityResult;
  try {
    const verdict = await verifyAuditChain(tenantId, environment, {
      limit: options.chainLimit ?? 100_000,
    });
    integrity = verdict.ok
      ? { ok: true, rowsChecked: snapshot.totalRows }
      : { ok: false, brokenAt: verdict.brokenAt, reason: verdict.reason };
  } catch (err) {
    logger.error('compliance: audit-chain replay threw', {
      tenantId,
      environment,
      error: (err as Error).message,
    });
    integrity = { ok: false, reason: `replay_error: ${(err as Error).message}` };
  }

  const generatedAt = new Date().toISOString();
  return {
    schemaVersion: EVIDENCE_PACK_VERSION,
    generatedAt,
    environment,
    tenant,
    providers,
    counts,
    hashChainSnapshot: snapshot,
    integrity,
    markdown: renderMarkdown(tenant, environment, providers, counts, snapshot, integrity, generatedAt),
    dpdp2tMemo: loadDpdp2tMemo(),
  };
}
