/**
 * Tenant Users view — PII-blacklist test (precursor to C-107).
 *
 * Four assertion blocks:
 *
 *   1. DID presence — every fixture DID is rendered.
 *   2. PII absence — none of the SENSITIVE_LEAK_PROBES substrings
 *      appear in the rendered DOM. Includes a regex sweep for
 *      Indian-style phone patterns ("+91 …").
 *   3. Source-file property reads — the component file itself
 *      contains zero textual references to `.full_name`, `.email`,
 *      `.phone`, `.employee_code`. This is the "even-if-we-forgot-
 *      to-pass-it" guard.
 *   4. Type-level — `expectTypeOf<TenantUserRow>()` must not contain
 *      any of the four PII keys. If `users-api.ts` is widened in a
 *      future commit the compiler-time test trips.
 *
 * Maps to agent-14 ticket A14-W3-Thu in
 * `docs/plan/bfsi-v1/agents/agent-14-fe-dashboard.md`, and to the
 * "no PII rendered" expectation from demo Scene 1 in
 * `docs/plan/bfsi-v1/02-bank-demo.md`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';

import { UsersView } from '../users';
import type { TenantUserRow } from '../../../lib/users-api';
import {
  fakeUsers,
  SENSITIVE_LEAK_PROBES,
  FORBIDDEN_FIELD_READS,
} from './users.fixtures';

// ─── Mock the users-api module so the component sees the fixtures ─

vi.mock('../../../lib/users-api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/users-api')>('../../../lib/users-api');
  return {
    ...actual,
    listUsers: vi.fn(),
  };
});

import { listUsers } from '../../../lib/users-api';

// ─── Render helper ──────────────────────────────────────────────

function renderUsersView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <UsersView />
    </QueryClientProvider>,
  );
}

describe('<UsersView /> — PII blacklist', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Assertion 1 — DID presence ────────────────────────────────

  it('renders every DID from the fixture set', async () => {
    vi.mocked(listUsers).mockResolvedValue({ users: fakeUsers });

    renderUsersView();

    for (const row of fakeUsers) {
      // The DID is rendered inside a <td>; findByText walks all
      // text nodes so we don't have to know the exact element.
      expect(await screen.findByText(row.did)).toBeInTheDocument();
    }
    // The mocked client was called.
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  // ── Assertion 2 — PII absence ─────────────────────────────────

  it('never renders an email or name field — no PII substrings leak through', async () => {
    vi.mocked(listUsers).mockResolvedValue({ users: fakeUsers });

    const { container } = renderUsersView();

    // Wait for the table to land so the DOM is fully populated.
    await screen.findByTestId('users-table');

    const rendered = container.textContent ?? '';

    for (const probe of SENSITIVE_LEAK_PROBES) {
      expect(
        rendered,
        `Rendered DOM contained forbidden PII substring "${probe}".`,
      ).not.toContain(probe);
    }

    // Generic phone-shape regex — catches "+91 90000 00000",
    // "+91-9000000000", "+919000000000". The probe '+91' above
    // covers the explicit prefix; this guards against any other
    // E.164-ish phone shape sneaking in even if the prefix changes.
    const phoneShape = /\+\d{1,3}[\s-]?\d{4,}/;
    expect(
      rendered,
      'Rendered DOM matched a phone-like pattern.',
    ).not.toMatch(phoneShape);
  });

  it('renders the empty state copy when the user list is empty', async () => {
    vi.mocked(listUsers).mockResolvedValue({ users: [] });

    renderUsersView();

    expect(await screen.findByText(/no users enrolled yet/i)).toBeInTheDocument();
  });

  // ── Assertion 3 — source-file property-read scan ──────────────

  it('users.tsx contains zero textual references to PII property reads', () => {
    // Resolve the component source path relative to this test file.
    const componentPath = path.resolve(__dirname, '../users.tsx');
    const src = fs.readFileSync(componentPath, 'utf8');

    // Strip the leading docstring before the scan — the file's
    // header doc deliberately names the forbidden fields as the
    // "must not be a column" allowlist guidance, and we want to
    // preserve that documentation. Everything after the first
    // top-level `import` is real code.
    const firstImport = src.indexOf('\nimport ');
    const codeOnly = firstImport > 0 ? src.slice(firstImport) : src;

    for (const forbidden of FORBIDDEN_FIELD_READS) {
      expect(
        codeOnly,
        `users.tsx code body must not contain the substring "${forbidden}".`,
      ).not.toContain(forbidden);
    }
  });

  // ── Assertion 4 — type-level ──────────────────────────────────

  it('TenantUserRow is structurally narrow — no PII keys at the type level', () => {
    // The `keyof TenantUserRow` union must not include any of the
    // forbidden field names. If a future commit widens the type, the
    // `extends` checks below collapse and the compiler fails the
    // build — which is the assertion we want.
    //
    // We additionally surface a runtime check by sampling a fixture
    // (so the assertion runs in vitest's output, not only at
    // typecheck time).

    expectTypeOf<TenantUserRow>().toHaveProperty('id');
    expectTypeOf<TenantUserRow>().toHaveProperty('did');
    expectTypeOf<TenantUserRow>().toHaveProperty('commitment');
    expectTypeOf<TenantUserRow>().toHaveProperty('tenantId');
    expectTypeOf<TenantUserRow>().toHaveProperty('environment');
    expectTypeOf<TenantUserRow>().toHaveProperty('createdAt');
    expectTypeOf<TenantUserRow>().not.toHaveProperty('full_name');
    expectTypeOf<TenantUserRow>().not.toHaveProperty('email');
    expectTypeOf<TenantUserRow>().not.toHaveProperty('phone');
    expectTypeOf<TenantUserRow>().not.toHaveProperty('employee_code');

    // Runtime echo so the assertion is visible in test output.
    const sample = fakeUsers[0]!;
    const keys = Object.keys(sample);
    expect(keys).not.toContain('full_name');
    expect(keys).not.toContain('email');
    expect(keys).not.toContain('phone');
    expect(keys).not.toContain('employee_code');
  });
});
