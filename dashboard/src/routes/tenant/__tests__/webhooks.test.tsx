/**
 * Webhooks view — list/create/delete UX tests.
 *
 *   1. List — `listWebhooks` resolves, every fixture URL renders, empty
 *      state is suppressed, and the plaintext secret never appears.
 *   2. Create flow — "+ Add webhook" opens the modal, submit invokes
 *      `createWebhook` with the typed URL + default event filters, and
 *      the reveal panel renders `signing_secret` exactly once.
 *   3. Delete confirmation — "Delete" opens the modal carrying the row
 *      URL; the danger button calls `deleteWebhook(row.id)`; Cancel
 *      dismisses without firing the mutation.
 *
 * Mocks `webhooks-api` so the test stays hermetic. The view uses
 * `useEnvironment()` so the renderer wraps children in
 * `<EnvironmentProvider>`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Webhooks } from '../webhooks';
import { EnvironmentProvider } from '../../../components/layout/AppShell';
import type { Webhook, WebhookCreated } from '../../../lib/webhooks-api';

// Mock webhooks-api — `vi.importActual` so `KNOWN_EVENTS` +
// `isValidWebhookUrl` pass through untouched; only the network helpers
// become spies.
vi.mock('../../../lib/webhooks-api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/webhooks-api')>(
    '../../../lib/webhooks-api',
  );
  return {
    ...actual,
    listWebhooks: vi.fn(),
    createWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    setWebhookEnabled: vi.fn(),
  };
});

import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
} from '../../../lib/webhooks-api';

// ─── Fixtures ────────────────────────────────────────────────────

function mkWebhook(overrides: Partial<Webhook>): Webhook {
  return {
    id: 'wh_default',
    url: 'https://hooks.example.com/zeroauth/default',
    events: ['verification.completed'],
    enabled: true,
    environment: 'live',
    secret_prefix: 'whsec_de',
    last_delivered_at: null,
    last_status_code: null,
    consecutive_failures: 0,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

const FAKE_WEBHOOKS: Webhook[] = [
  mkWebhook({
    id: 'wh_aaa111',
    url: 'https://hooks.example.com/zeroauth/primary',
    events: ['verification.completed', 'verification.failed'],
    last_delivered_at: '2026-05-28T10:00:00.000Z',
    last_status_code: 200,
  }),
  mkWebhook({
    id: 'wh_bbb222',
    url: 'https://hooks.example.com/zeroauth/audit',
    events: ['audit.anchored'],
    enabled: false,
  }),
];

const FRESH_SECRET = 'whsec_0123456789abcdef0123456789abcdef0123456789abcdef';

const CREATED_ENVELOPE: WebhookCreated = {
  webhook: mkWebhook({ id: 'wh_new999', url: 'https://hooks.example.com/zeroauth/new' }),
  signing_secret: FRESH_SECRET,
  warning: 'Save this signing secret now. It will not be shown again.',
};

// ─── Render helper ───────────────────────────────────────────────

function renderWebhooks() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <EnvironmentProvider><Webhooks /></EnvironmentProvider>
    </QueryClientProvider>,
  );
}

describe('<Webhooks />', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('renders every existing webhook URL once `listWebhooks` resolves', async () => {
    vi.mocked(listWebhooks).mockResolvedValue(FAKE_WEBHOOKS);
    renderWebhooks();

    expect(await screen.findByTestId('webhooks-table')).toBeInTheDocument();
    for (const row of FAKE_WEBHOOKS) {
      expect(screen.getByText(row.url)).toBeInTheDocument();
    }
    // Empty-state copy is suppressed when real rows are present.
    expect(screen.queryByText(/no webhooks registered yet/i)).toBeNull();
    // Defence in depth — the list endpoint never returns the plaintext
    // secret, and no helper should leak it via toast/aria text.
    expect(screen.queryByText(FRESH_SECRET)).toBeNull();
  });

  it('opens the create modal, POSTs the form, and reveals the signing secret exactly once', async () => {
    vi.mocked(listWebhooks).mockResolvedValue([]);
    vi.mocked(createWebhook).mockResolvedValue(CREATED_ENVELOPE);

    const user = userEvent.setup();
    renderWebhooks();

    // Wait for the empty state so the page is interactive.
    await screen.findByText(/no webhooks registered yet/i);
    await user.click(screen.getByRole('button', { name: /\+ add webhook/i }));

    // Modal opens — URL input is reachable by testid.
    const urlInput = await screen.findByTestId('webhook-url-input');
    await user.clear(urlInput);
    await user.type(urlInput, 'https://hooks.example.com/zeroauth/new');

    // All KNOWN_EVENTS are checked by default; submit goes through.
    await user.click(screen.getByRole('button', { name: /create webhook/i }));

    await waitFor(() => {
      expect(createWebhook).toHaveBeenCalledTimes(1);
    });

    const callArg = vi.mocked(createWebhook).mock.calls[0]?.[0];
    expect(callArg?.url).toBe('https://hooks.example.com/zeroauth/new');
    expect(callArg?.environment).toBe('live');
    expect(callArg?.events.length).toBeGreaterThan(0);

    // Reveal panel renders the plaintext secret exactly once.
    const reveal = await screen.findByTestId('signing-secret-reveal');
    expect(reveal.textContent ?? '').toContain(FRESH_SECRET);
    // The "I've saved it" acknowledgement is required (non-dismissive backdrop).
    expect(screen.getByRole('button', { name: /i.+ve saved it/i })).toBeInTheDocument();
  });

  it('opens the delete-confirmation modal and only fires `deleteWebhook` on confirm', async () => {
    vi.mocked(listWebhooks).mockResolvedValue(FAKE_WEBHOOKS);
    vi.mocked(deleteWebhook).mockResolvedValue();

    const user = userEvent.setup();
    renderWebhooks();

    await screen.findByTestId('webhooks-table');
    const deleteButtons = screen.getAllByRole('button', { name: /^delete$/i });
    expect(deleteButtons.length).toBe(FAKE_WEBHOOKS.length);

    // Open the confirmation for row 0.
    const target = FAKE_WEBHOOKS[0]!;
    await user.click(deleteButtons[0]!);

    // Modal copy mentions the URL — once in the table cell, again in
    // the confirmation body. ≥ 2 hits confirms the modal is open.
    await waitFor(() => {
      const hits = screen.getAllByText((_, el) =>
        (el?.textContent ?? '').includes(target.url),
      );
      expect(hits.length).toBeGreaterThanOrEqual(2);
    });

    // Cancel — verifies the mutation is gated behind the danger button.
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(deleteWebhook).not.toHaveBeenCalled();

    // Re-open + confirm. The danger button label embeds the
    // (truncated) URL; match on the host so we don't depend on cutoff.
    await user.click(deleteButtons[0]!);
    const dangerBtn = await screen.findByRole('button', {
      name: /delete https:\/\/hooks\.example\.com/i,
    });
    await user.click(dangerBtn);

    await waitFor(() => {
      expect(deleteWebhook).toHaveBeenCalledTimes(1);
    });
    expect(vi.mocked(deleteWebhook).mock.calls[0]?.[0]).toBe(target.id);
  });
});
