/**
 * SecurityPolicyView — ADR 0017 (blockchain-agnostic posture).
 *
 * Five assertion blocks:
 *   1. Render — every dropdown carries the current server value and
 *      the inline help reflects that pick.
 *   2. Save — flipping a dropdown enables Save, clicking it calls
 *      `updateSecurityPolicy` with the camelCase draft, toasts success.
 *   3. Error — a rejecting mutation emits a danger toast carrying the
 *      server message verbatim; the form draft is preserved for retry.
 *   4. Loading — the skeleton renders before the GET resolves.
 *   5. Error banner — a rejecting GET surfaces the "could not load"
 *      banner and falls back to the off-chain defaults.
 *
 * Mocks `security-policy-api` (the page's direct dependency) and the
 * `pushToast` export from `components/ui` so the toast surface is
 * observable. The real fetch in `api.ts` is never reached — the API
 * client surface is stubbed and the test stays hermetic.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SecurityPolicyView } from '../security-policy';
import type { SecurityPolicy } from '../../../lib/security-policy-api';

// Mock the api client surface (importActual preserves type unions +
// DEFAULT_POLICY) and the pushToast global so toast tone is observable.
vi.mock('../../../lib/security-policy-api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/security-policy-api')>(
    '../../../lib/security-policy-api',
  );
  return { ...actual, getSecurityPolicy: vi.fn(), updateSecurityPolicy: vi.fn() };
});
vi.mock('../../../components/ui', async () => {
  const actual = await vi.importActual<typeof import('../../../components/ui')>(
    '../../../components/ui',
  );
  return { ...actual, pushToast: vi.fn() };
});

import {
  getSecurityPolicy,
  updateSecurityPolicy,
} from '../../../lib/security-policy-api';
import { pushToast } from '../../../components/ui';
import { ApiError } from '../../../lib/api';

const CURRENT_POLICY: SecurityPolicy = {
  didProvider: 'off-chain',
  verifierProvider: 'off-chain',
  auditAnchorProvider: 'none',
};

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SecurityPolicyView />
    </QueryClientProvider>,
  );
}

describe('<SecurityPolicyView />', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Render current values ──────────────────────────────────

  it('renders the three dropdowns seeded with the current server policy', async () => {
    vi.mocked(getSecurityPolicy).mockResolvedValue(CURRENT_POLICY);

    renderView();
    await screen.findByTestId('security-policy-form');

    const didSelect = screen.getByTestId('did-provider') as HTMLSelectElement;
    const verifierSelect = screen.getByTestId('verifier-provider') as HTMLSelectElement;
    const anchorSelect = screen.getByTestId('audit-anchor-provider') as HTMLSelectElement;

    expect(didSelect.value).toBe('off-chain');
    expect(verifierSelect.value).toBe('off-chain');
    expect(anchorSelect.value).toBe('none');

    // Inline help reflects the picked option.
    expect(screen.getByTestId('did-provider-help').textContent ?? '').toMatch(
      /DIDs live in PostgreSQL only/i,
    );

    // Save is gated until the operator dirties the form.
    expect((screen.getByTestId('security-policy-save') as HTMLButtonElement).disabled).toBe(true);
    expect(getSecurityPolicy).toHaveBeenCalledTimes(1);
  });

  // ── 2. Save submits the form ──────────────────────────────────

  it('flipping a provider and clicking Save calls updateSecurityPolicy and toasts success', async () => {
    const SAVED: SecurityPolicy = { ...CURRENT_POLICY, didProvider: 'base-sepolia' };
    vi.mocked(getSecurityPolicy).mockResolvedValue(CURRENT_POLICY);
    vi.mocked(updateSecurityPolicy).mockResolvedValue(SAVED);

    renderView();
    await screen.findByTestId('security-policy-form');

    const didSelect = screen.getByTestId('did-provider') as HTMLSelectElement;
    await userEvent.selectOptions(didSelect, 'base-sepolia');
    expect(didSelect.value).toBe('base-sepolia');

    // Inline help re-renders against the new pick.
    expect(screen.getByTestId('did-provider-help').textContent ?? '').toMatch(/Base Sepolia L2/i);

    const save = screen.getByTestId('security-policy-save') as HTMLButtonElement;
    expect(save.disabled).toBe(false);

    await userEvent.click(save);

    await waitFor(() => {
      expect(updateSecurityPolicy).toHaveBeenCalledTimes(1);
    });

    // TanStack Query passes a second context arg; assert on the first
    // positional only — that's the page-controlled payload.
    expect(vi.mocked(updateSecurityPolicy).mock.calls[0]?.[0]).toEqual({
      didProvider: 'base-sepolia',
      verifierProvider: 'off-chain',
      auditAnchorProvider: 'none',
    });

    await waitFor(() => {
      expect(pushToast).toHaveBeenCalledWith('success', expect.stringMatching(/saved/i));
    });
  });

  // ── 3. Error toast on API failure ─────────────────────────────

  it('emits a danger toast carrying the server message verbatim when the save rejects', async () => {
    const SERVER_MESSAGE =
      'Provider chain config missing — coordinate with platform ops before selecting base-mainnet.';
    vi.mocked(getSecurityPolicy).mockResolvedValue(CURRENT_POLICY);
    vi.mocked(updateSecurityPolicy).mockRejectedValue(
      new ApiError(409, 'provider_chain_missing_config', SERVER_MESSAGE),
    );

    renderView();
    await screen.findByTestId('security-policy-form');

    // Dirty the form so the submit path is reachable.
    await userEvent.selectOptions(
      screen.getByTestId('did-provider') as HTMLSelectElement,
      'base-mainnet',
    );
    await userEvent.click(screen.getByTestId('security-policy-save'));

    await waitFor(() => {
      expect(updateSecurityPolicy).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(pushToast).toHaveBeenCalledWith('danger', SERVER_MESSAGE);
    });

    // Operator can retry without re-picking — the draft survives.
    expect((screen.getByTestId('did-provider') as HTMLSelectElement).value).toBe('base-mainnet');

    // No success toast leaked through.
    expect(vi.mocked(pushToast).mock.calls.find(([tone]) => tone === 'success')).toBeUndefined();
  });

  // ── 4. Loading skeleton before the GET resolves ──────────────

  it('renders the loading skeleton before the initial GET resolves', () => {
    vi.mocked(getSecurityPolicy).mockReturnValue(new Promise(() => {}));

    renderView();

    expect(screen.getByTestId('security-policy-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('security-policy-form')).toBeNull();
  });

  // ── 5. Error banner on GET failure ───────────────────────────

  it('renders the load-error banner and falls back to defaults when the GET rejects', async () => {
    vi.mocked(getSecurityPolicy).mockRejectedValue(
      new ApiError(500, 'http_500', 'Server temporarily unavailable.'),
    );

    renderView();

    expect(await screen.findByTestId('security-policy-error')).toBeInTheDocument();
    expect(screen.getByText(/Could not load the current security policy/i)).toBeInTheDocument();

    // Defaults visible — off-chain across the board.
    expect((screen.getByTestId('did-provider') as HTMLSelectElement).value).toBe('off-chain');
  });
});
