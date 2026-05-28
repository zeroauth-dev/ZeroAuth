/**
 * Fixtures for the tenant users-view PII-blacklist test.
 *
 * Two parallel collections are exported:
 *
 *   1. `fakeUsers` — the rows the dashboard sees on the wire. By
 *      design these carry ONLY the six fields of `TenantUserRow`
 *      (id, did, commitment, tenantId, environment, createdAt).
 *      A failing-test future where someone widens the type will
 *      not be able to add PII here without the TypeScript compiler
 *      flagging it.
 *
 *   2. `SENSITIVE_LEAK_PROBES` — substrings that represent the PII
 *      the server's `tenant_users` table currently holds (full
 *      name, work email, phone, employee code). These strings are
 *      **deliberately never put on a fixture row** — they are the
 *      "negative space" the test sweeps for in the rendered DOM.
 *      If a future refactor accidentally pipes server PII through
 *      to the UI, the test fails because one of these substrings
 *      will start showing up.
 *
 * Reading the prompt: "deliberately-sensitive-but-not-leaked
 * metadata (so the no-leak test has meaningful data)." This is
 * what that means in practice — we know there is a parallel reality
 * where Alice's full name and email live on the server row; we
 * encode that parallel reality here so the assertion has shape.
 */

import type { TenantUserRow } from '../../../lib/users-api';

/**
 * Three fake enrolled users. The data principal cannot be identified
 * from a Poseidon commitment + opaque DID — that's the DPDP §2(t)
 * argument the legal memo (`docs/compliance/dpdp-2t-memo.md`) makes.
 */
export const fakeUsers: TenantUserRow[] = [
  {
    id: 'usr_01HV5MD8X3PNFQR2K1G3WAY1',
    did: 'did:zeroauth:anchor:0x7a3c9f5b8e1d2a4c6f0b9e3d5a7c1f8b',
    commitment: '0x21b7c4f08e9a5d63',
    tenantId: 'tnt_anchor_bank',
    environment: 'live',
    createdAt: '2026-05-20T10:14:00.000Z',
  },
  {
    id: 'usr_01HV5MEK7C9DGN8P0M6T2BR3',
    did: 'did:zeroauth:anchor:0x4f1d2b87c5e0a9647d3b8f0e1a2c5d4e',
    commitment: '0x9c0d2e4af1b86503',
    tenantId: 'tnt_anchor_bank',
    environment: 'live',
    createdAt: '2026-05-21T15:42:00.000Z',
  },
  {
    id: 'usr_01HV5MGS4PXJB72WHFA9V5KE',
    did: 'did:zeroauth:anchor:0x9e0a3f6b1d8c4527e0a3f6b1d8c45271',
    commitment: '0x6f1ba74e08c5d932',
    tenantId: 'tnt_anchor_bank',
    environment: 'test',
    createdAt: '2026-05-22T09:05:00.000Z',
  },
];

/**
 * PII substrings that must NEVER appear in the rendered DOM.
 *
 * Picked deliberately: each one represents a class of leak we want
 * to defend against. The names are obvious sample names; the email
 * domain `@example.com` is the canonical placeholder; `+91` matches
 * any Indian mobile prefix; `EMP-` matches HR-style employee codes.
 */
export const SENSITIVE_LEAK_PROBES = [
  // Sample full names — would only appear if the component started
  // reading a `full_name` field off the server row.
  'Alice',
  'Bob',
  'Charlie',
  // Work-email placeholder — would only appear if the component
  // started reading an `email` field.
  '@example.com',
  // Indian phone-number prefix — would only appear if a `phone`
  // field were rendered. The Anchor Bank demo uses real Indian
  // numbers in production, so this is the most demo-relevant probe.
  '+91',
  // Employee-code prefix — would only appear if `employee_code`
  // were rendered.
  'EMP-',
] as const;

/**
 * Field names the component file must never reference. The test
 * greps the file source for these substrings.
 */
export const FORBIDDEN_FIELD_READS = [
  '.full_name',
  '.email',
  '.phone',
  '.employee_code',
] as const;
