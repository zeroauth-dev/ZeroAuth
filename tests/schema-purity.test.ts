/**
 * Schema-purity test (Phase 0 commit C-003).
 *
 * Two contracts pinned here:
 *
 * 1. **PII column allowlist** — every column on `tenant_users` must
 *    be on the current-state allowlist below. New columns added later
 *    fail the test until a reviewer confirms they are non-PII or
 *    explicitly broadens the allowlist with an ADR.
 *
 *    NOTE: today's `tenant_users` carries `full_name`, `email`,
 *    `phone`, `employee_code` — all PII. Pain-point P1 in
 *    docs/plan/bfsi-v1/01-pain-points.md and demo Scene 4 in
 *    docs/plan/bfsi-v1/02-bank-demo.md require the end-state to be a
 *    DID-and-commitment-only table. The migration that removes these
 *    columns lands in Phase 1 (the plan calls it the "PII strip"
 *    follow-on to C-121). Until then this test locks down the
 *    CURRENT state so no NEW PII columns sneak in.
 *
 * 2. **Forbidden column-name patterns** — no column on any tenant-
 *    scoped table may have a name suggesting raw biometric data:
 *    `image`, `template`, `pixel`, `depth`, `frame`, `raw_face`,
 *    `raw_finger`. This is the schema-side mirror of the input-
 *    validator blocklist (tests/biometric-rejection.test.ts).
 *
 * The test reads the table definitions out of `src/services/db.ts`
 * so it runs without a live Postgres. Integration suites separately
 * verify the runtime schema matches what's in source.
 */

import * as fs from 'fs';
import * as path from 'path';

const dbSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/services/db.ts'),
  'utf8',
);

function extractTableBody(table: string): string {
  // Match: CREATE TABLE IF NOT EXISTS <table> ( ... );
  const re = new RegExp(
    `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\s*\\(([\\s\\S]*?)\\);`,
    'i',
  );
  const m = dbSrc.match(re);
  if (!m) {
    throw new Error(`Could not find CREATE TABLE for ${table} in src/services/db.ts`);
  }
  return m[1];
}

function extractColumnNames(tableBody: string): string[] {
  // Each column declaration starts at the beginning of a line with
  // an identifier. We strip out CHECK, UNIQUE, PRIMARY, FOREIGN,
  // REFERENCES-only constraint lines.
  const lines = tableBody
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .filter(l => !l.startsWith('--'));
  const cols: string[] = [];
  for (const line of lines) {
    if (/^(CHECK|UNIQUE|PRIMARY|FOREIGN|CONSTRAINT)\b/i.test(line)) continue;
    if (/^REFERENCES\b/i.test(line)) continue;
    const m = line.match(/^([a-z_][a-z0-9_]*)\b/i);
    if (m) cols.push(m[1].toLowerCase());
  }
  return cols;
}

describe('schema-purity (tenant-scoped tables)', () => {
  // ─── tenant_users ─────────────────────────────────────────────────

  it('tenant_users has only the current-state allowed columns', () => {
    const ALLOWED_TENANT_USERS = new Set([
      'id',
      'tenant_id',
      'environment',
      'external_id',
      // PII columns scheduled for removal in Phase 1 PII-strip migration:
      'full_name',
      'email',
      'phone',
      'employee_code',
      // End of PII-scheduled-for-removal.
      'status',
      'primary_device_id',
      'metadata',
      'last_verified_at',
      'created_at',
      'updated_at',
    ]);
    const body = extractTableBody('tenant_users');
    const cols = extractColumnNames(body);
    const unexpected = cols.filter(c => !ALLOWED_TENANT_USERS.has(c));
    expect(unexpected).toEqual([]);
  });

  // ─── audit_events ─────────────────────────────────────────────────

  it('audit_events allowlist is current; flag any new field for ADR review', () => {
    const ALLOWED_AUDIT_EVENTS = new Set([
      'id',
      'tenant_id',
      'environment',
      'actor_type',
      'actor_id',
      'action',
      'entity_type',
      'entity_id',
      'status',
      'summary',
      'metadata',
      'created_at',
      'ip_address',
      'user_agent',
      // Phase 0 ADR 0013 + 0014 will add these in C-011:
      'previous_hash',
      'event_hash',
    ]);
    const body = extractTableBody('audit_events');
    const cols = extractColumnNames(body);
    const unexpected = cols.filter(c => !ALLOWED_AUDIT_EVENTS.has(c));
    expect(unexpected).toEqual([]);
  });

  // ─── audit_anchors (ADR 0014) ─────────────────────────────────────

  it('audit_anchors has only the ADR 0014 allowed columns', () => {
    const ALLOWED_AUDIT_ANCHORS = new Set([
      'id',
      'tenant_id',
      'environment',
      'day_utc',
      'terminal_hash',
      'row_count',
      'tx_hash',
      'block_number',
      'anchored_at',
    ]);
    const body = extractTableBody('audit_anchors');
    const cols = extractColumnNames(body);
    const unexpected = cols.filter(c => !ALLOWED_AUDIT_ANCHORS.has(c));
    expect(unexpected).toEqual([]);
  });

  // ─── Forbidden biometric column-name patterns ─────────────────────

  const FORBIDDEN_PATTERNS = [
    /\bimage\b/i,
    /\btemplate\b/i,
    /\bpixel\b/i,
    /\bdepth\b/i,
    /\bframe\b/i,
    /\braw_face\b/i,
    /\braw_finger\b/i,
    /\bbiometric_data\b/i,
    /\bphoto\b/i,
  ];

  const TENANT_SCOPED_TABLES = [
    'tenant_users',
    'devices',
    'verification_events',
    'attendance_events',
    'audit_events',
    'audit_anchors',
    'proof_pairing_sessions',
    'api_keys',
    'usage_logs',
    'usage_monthly',
  ];

  for (const table of TENANT_SCOPED_TABLES) {
    it(`${table}: no column name suggests raw biometric data`, () => {
      const body = extractTableBody(table);
      const cols = extractColumnNames(body);
      for (const col of cols) {
        for (const pattern of FORBIDDEN_PATTERNS) {
          expect({ col, pattern: pattern.source }).not.toMatchObject({
            col: expect.stringMatching(pattern),
            pattern: pattern.source,
          });
        }
      }
    });
  }

  // ─── rate_limit_buckets ───────────────────────────────────────────
  //
  // C-026 / audit finding C-10: Postgres-backed rate-limit table.
  // Intentionally not (tenant_id, environment)-scoped — the
  // /api/console/login bucket exists BEFORE any tenant is resolved.
  // Hence the column allowlist is checked here but the table is
  // omitted from TENANT_SCOPED_TABLES above (the forbidden-pattern
  // loop). The KNOWN_TABLES set below still requires the table to be
  // declared; only the per-tenant guard is opted out of.

  it('rate_limit_buckets has only the allowed columns', () => {
    const ALLOWED_RATE_LIMIT_BUCKETS = new Set([
      'bucket_key',
      'count',
      'window_start',
      'expires_at',
    ]);
    const body = extractTableBody('rate_limit_buckets');
    const cols = extractColumnNames(body);
    const unexpected = cols.filter(c => !ALLOWED_RATE_LIMIT_BUCKETS.has(c));
    expect(unexpected).toEqual([]);
  });

  it('rate_limit_buckets: no column name suggests raw biometric data', () => {
    // The table is not tenant-scoped (see comment above) so it skips
    // the TENANT_SCOPED_TABLES loop, but the biometric-name guard
    // still applies — it's a global ban on raw-data columns.
    const body = extractTableBody('rate_limit_buckets');
    const cols = extractColumnNames(body);
    for (const col of cols) {
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect({ col, pattern: pattern.source }).not.toMatchObject({
          col: expect.stringMatching(pattern),
          pattern: pattern.source,
        });
      }
    }
  });

  // ─── New-table guard ──────────────────────────────────────────────

  it('all CREATE TABLE statements correspond to a known table in this test', () => {
    const KNOWN_TABLES = new Set([
      'leads',
      'tenants',
      'pending_signups',
      'api_keys',
      'usage_logs',
      'usage_monthly',
      'devices',
      'tenant_users',
      'verification_events',
      'attendance_events',
      'proof_pairing_sessions',
      'audit_events',
      'audit_anchors',
      // C-026 / audit finding C-10. Intentionally NOT in
      // TENANT_SCOPED_TABLES above — the /api/console/login bucket
      // exists before any tenant is resolved.
      'rate_limit_buckets',
    ]);
    const createTableRe = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)/gi;
    const tables = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = createTableRe.exec(dbSrc)) !== null) {
      tables.add(m[1].toLowerCase());
    }
    const unknown = [...tables].filter(t => !KNOWN_TABLES.has(t));
    expect(unknown).toEqual([]);
  });
});
