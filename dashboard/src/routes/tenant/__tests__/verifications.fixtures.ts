/**
 * Fixtures for the tenant live-verifications PII-blacklist test.
 *
 * Two parallel collections are exported:
 *
 *   1. `fakeVerifications` — five synthetic VerificationEvent rows.
 *      By design each row carries ONLY the nine fields of the
 *      narrow `VerificationEvent` type. A failing-test future
 *      where someone widens the type cannot add PII here without
 *      the TypeScript compiler flagging it.
 *
 *   2. `SENSITIVE_LEAK_PROBES` — substrings that represent the PII
 *      the server's downstream tables carry (full name, work
 *      email, phone, employee code). These strings are
 *      **deliberately never put on a fixture row** — they are the
 *      "negative space" the test sweeps for in the rendered DOM.
 *      Same shape as the users fixtures in commit `6e06a14`.
 *
 * Reading the prompt: "5 fake verification events with
 * deliberately-sensitive-but-not-leaked metadata." That means each
 * row simulates a real verification (varying DIDs, environments,
 * pass/fail outcomes, latencies) and the test asserts the rendered
 * DOM contains none of the sensitive substrings — confirming that
 * the no-PII contract holds even under representative data.
 */

import type { VerificationEvent } from '../../../lib/verifications-api';

/**
 * Five fake verification events. The data principal cannot be
 * identified from a DID + outcome code — that's the DPDP §2(t)
 * argument the legal memo (`docs/compliance/dpdp-2t-memo.md`)
 * makes.
 *
 * The mix of outcomes/environments exercises the view's counters
 * and the success/failure chip rendering paths.
 */
export const fakeVerifications: VerificationEvent[] = [
  {
    auditId: '40001',
    action: 'verification.verify_success',
    did: 'did:zeroauth:anchor:0x7a3c9f5b8e1d2a4c6f0b9e3d5a7c1f8b',
    environment: 'live',
    result: 'success',
    latencyMs: 1840,
    createdAt: '2026-05-28T10:14:00.000Z',
    proofHash: '0x21b7c4f08e9a5d63',
    reason: null,
  },
  {
    auditId: '40002',
    action: 'verification.verify_failure',
    did: 'did:zeroauth:anchor:0x4f1d2b87c5e0a9647d3b8f0e1a2c5d4e',
    environment: 'live',
    result: 'failure',
    latencyMs: 5210,
    createdAt: '2026-05-28T10:14:42.000Z',
    proofHash: '0x9c0d2e4af1b86503',
    reason: 'proof_invalid',
  },
  {
    auditId: '40003',
    action: 'verification.verify_success',
    did: 'did:zeroauth:anchor:0x9e0a3f6b1d8c4527e0a3f6b1d8c45271',
    environment: 'test',
    result: 'success',
    latencyMs: 1240,
    createdAt: '2026-05-28T10:15:11.000Z',
    proofHash: '0x6f1ba74e08c5d932',
    reason: null,
  },
  {
    auditId: '40004',
    action: 'verification.verify_success',
    did: 'did:zeroauth:anchor:0x3b8d1f5c7e2a4f6b9c0d8e1a5f3b2c7d',
    environment: 'live',
    result: 'success',
    latencyMs: 1620,
    createdAt: '2026-05-28T10:15:35.000Z',
    proofHash: '0xc4b8a1f3e7d29065',
    reason: null,
  },
  {
    auditId: '40005',
    action: 'verification.verify_failure',
    did: 'did:zeroauth:anchor:0xfe3c2b8a1d5f7e0c4b3a9d8e2c1f5b6a',
    environment: 'test',
    result: 'failure',
    latencyMs: 2780,
    createdAt: '2026-05-28T10:16:02.000Z',
    proofHash: null,
    reason: 'nonce_mismatch',
  },
];

/**
 * PII substrings that must NEVER appear in the rendered DOM.
 *
 * Same probes as the users-view fixtures at commit `6e06a14`.
 * Each probe represents a class of leak we want to defend against:
 *
 *   - Sample full names — would only appear if the component
 *     started reading a `full_name` field off an upstream row.
 *   - `@example.com` — work-email placeholder; would only appear
 *     if an `email` field were rendered.
 *   - `+91` — Indian phone-number prefix; would only appear if a
 *     `phone` field were rendered.
 *   - `EMP-` — employee-code prefix; would only appear if
 *     `employee_code` were rendered.
 */
export const SENSITIVE_LEAK_PROBES = [
  'Alice',
  'Bob',
  'Charlie',
  '@example.com',
  '+91',
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
