import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QrProofLogin from './QrProofLogin';
import type { PairingSession, PairingStream, PairingStreamEvent } from '../../lib/api';

// We mock the whole api module so we control createSession + subscribeStream
// behaviour per-test. The QrProofLogin page is the unit under test; the
// network and SSE layers have their own tests (api.test.ts).
vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      pairing: {
        createSession: vi.fn(),
        getSession: vi.fn(),
        submitProof: vi.fn(),
        cancelSession: vi.fn(),
        subscribeStream: vi.fn(),
        isMockMode: vi.fn().mockReturnValue(false),
      },
    },
    __mockBind: vi.fn(),
    __mockExpire: vi.fn(),
  };
});

import { api } from '../../lib/api';

// ─── Fixtures + helpers ─────────────────────────────────────────

function fakeSession(overrides: Partial<PairingSession> = {}): PairingSession {
  return {
    id: '9f8e2a4b-1c0d-4e9a-bd33-2a44f0e7e9d1',
    nonce: 'a'.repeat(62),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    qrPayload: 'za:pair:1:9f8e2a4b:nonce:zeroauth.test:abcd',
    streamUrl: '/api/console/proof-pairing/sessions/9f8e2a4b/stream',
    state: 'issued',
    ...overrides,
  };
}

/**
 * Build an in-memory stand-in for PairingStream that the test can drive
 * by calling .emit('session_bound', payload). Mirrors the real shape
 * returned by api.pairing.subscribeStream so the page can't tell the
 * difference.
 */
function buildFakeStream(): PairingStream & {
  emit: (event: PairingStreamEvent) => void;
  closed: boolean;
} {
  type Handler = (event: PairingStreamEvent) => void;
  const handlers = new Map<PairingStreamEvent['type'], Set<Handler>>();
  let closed = false;

  const stream: PairingStream & { emit: (event: PairingStreamEvent) => void; closed: boolean } = {
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) {
        set = new Set();
        handlers.set(type, set);
      }
      set.add(handler as Handler);
      return () => {
        set!.delete(handler as Handler);
      };
    },
    close() {
      closed = true;
      stream.closed = true;
      handlers.clear();
    },
    emit(event) {
      const set = handlers.get(event.type);
      if (!set) return;
      for (const h of set) h(event);
    },
    closed,
  };
  return stream;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/demo/qr-proof-login']}>
        <Routes>
          <Route path="/demo/qr-proof-login" element={<QrProofLogin />} />
          <Route path="/overview" element={<div>Overview page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('<QrProofLogin />', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders the QR + countdown once createSession resolves', async () => {
    const session = fakeSession();
    vi.mocked(api.pairing.createSession).mockResolvedValue({ session });
    const stream = buildFakeStream();
    vi.mocked(api.pairing.subscribeStream).mockReturnValue(stream);

    renderPage();

    // Heading is always present.
    expect(await screen.findByRole('heading', { name: /sign in with your phone/i })).toBeInTheDocument();

    // QR image renders once the session is back.
    const qr = await screen.findByTestId('pairing-qr');
    expect(qr).toBeInTheDocument();

    // Payload is also rendered as the paste-fallback.
    expect(screen.getByText(session.qrPayload)).toBeInTheDocument();

    expect(api.pairing.createSession).toHaveBeenCalledTimes(1);
    expect(api.pairing.subscribeStream).toHaveBeenCalledWith(session.id);
  });

  it('shows the expired card when SSE emits session_expired', async () => {
    const session = fakeSession();
    vi.mocked(api.pairing.createSession).mockResolvedValue({ session });
    const stream = buildFakeStream();
    vi.mocked(api.pairing.subscribeStream).mockReturnValue(stream);

    renderPage();
    await screen.findByTestId('pairing-qr');

    await act(async () => {
      stream.emit({ type: 'session_expired', id: session.id, state: 'expired' });
    });

    expect(await screen.findByText(/something went sideways/i)).toBeInTheDocument();
    expect(screen.getByText(/expired before the phone/i)).toBeInTheDocument();
    expect(screen.getByTestId('restart-button')).toBeInTheDocument();
  });

  it('shows the success card when SSE emits session_bound', async () => {
    const session = fakeSession();
    vi.mocked(api.pairing.createSession).mockResolvedValue({ session });
    const stream = buildFakeStream();
    vi.mocked(api.pairing.subscribeStream).mockReturnValue(stream);

    renderPage();
    await screen.findByTestId('pairing-qr');

    act(() => {
      stream.emit({
        type: 'session_bound',
        id: session.id,
        state: 'bound',
        userId: 'u-1',
        did: 'did:zeroauth:test:abc',
        tokens: { accessToken: 'jwt-bound', tokenType: 'Bearer', expiresIn: 3600 },
        userEmail: 'demo@zeroauth.dev',
      });
    });

    expect(await screen.findByText(/welcome back, demo@zeroauth.dev/i)).toBeInTheDocument();
  });

  it('closes the EventSource-like stream on unmount', async () => {
    const session = fakeSession();
    vi.mocked(api.pairing.createSession).mockResolvedValue({ session });
    const stream = buildFakeStream();
    vi.mocked(api.pairing.subscribeStream).mockReturnValue(stream);

    const { unmount } = renderPage();
    await screen.findByTestId('pairing-qr');

    expect(stream.closed).toBe(false);
    unmount();
    expect(stream.closed).toBe(true);
  });

  it('retry button calls createSession again', async () => {
    const session = fakeSession();
    vi.mocked(api.pairing.createSession).mockResolvedValue({ session });
    const stream = buildFakeStream();
    vi.mocked(api.pairing.subscribeStream).mockReturnValue(stream);

    renderPage();
    await screen.findByTestId('pairing-qr');

    // Drive to the expired card.
    act(() => {
      stream.emit({ type: 'session_expired', id: session.id, state: 'expired' });
    });
    const restart = await screen.findByTestId('restart-button');

    vi.mocked(api.pairing.createSession).mockClear();
    // Set up a fresh fake stream for the second go-round.
    const stream2 = buildFakeStream();
    vi.mocked(api.pairing.subscribeStream).mockReturnValue(stream2);

    await userEvent.click(restart);

    await waitFor(() => expect(api.pairing.createSession).toHaveBeenCalledTimes(1));
    // And the page should be back to a QR render.
    expect(await screen.findByTestId('pairing-qr')).toBeInTheDocument();
  });
});
