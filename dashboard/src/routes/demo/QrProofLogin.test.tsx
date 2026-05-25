import { describe, it, expect, vi, afterEach } from 'vitest';
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

// QrScanner is mocked here — its own unit tests cover the webcam +
// BarcodeDetector internals. The page-level test only needs to know
// that the scanner exposes an onDetected callback that delivers a raw
// QR text upstream. We render a tiny test harness that surfaces a
// button to drive that callback synchronously.
vi.mock('../../components/QrScanner', () => ({
  QrScanner: (props: { onDetected: (text: string) => void; expectedPrefix?: string }) => (
    <div data-testid="qr-scanner-mock">
      <button
        type="button"
        data-testid="qr-scanner-mock-detect"
        onClick={() => props.onDetected(`${props.expectedPrefix ?? ''}MOCK-PROOF-PAYLOAD`)}
      >
        Simulate scan
      </button>
    </div>
  ),
}));

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

type FakeStream = ReturnType<typeof buildFakeStream>;

/**
 * Configure `api.pairing.createSession` + `subscribeStream` so the test
 * can:
 *   - know exactly which stream the page subscribed to (captured by
 *     `subscribed.stream` after `await waitForSubscription()`),
 *   - emit through the captured handle.
 *
 * Replaces the older "create-stream-then-mockReturnValue" pattern which
 * raced on the page's own SSE useEffect — the test's stream and the
 * page's stream were the same object but the subscriber/emitter
 * handshake wasn't guaranteed to land before `act()` returned.
 */
function wireSession(session: PairingSession): {
  subscribed: { stream: FakeStream | null };
  waitForSubscription: () => Promise<FakeStream>;
} {
  vi.mocked(api.pairing.createSession).mockResolvedValue({ session });
  const subscribed: { stream: FakeStream | null } = { stream: null };
  vi.mocked(api.pairing.subscribeStream).mockImplementation(() => {
    const s = buildFakeStream();
    subscribed.stream = s;
    return s;
  });
  return {
    subscribed,
    waitForSubscription: async () => {
      await waitFor(() => {
        if (!subscribed.stream) throw new Error('stream not yet subscribed');
      });
      return subscribed.stream!;
    },
  };
}

describe('<QrProofLogin />', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the QR + countdown once createSession resolves', async () => {
    const session = fakeSession();
    wireSession(session);

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
    const wire = wireSession(session);

    renderPage();
    await screen.findByTestId('pairing-qr');
    const stream = await wire.waitForSubscription();

    await act(async () => {
      stream.emit({ type: 'session_expired', id: session.id, state: 'expired' });
    });

    expect(await screen.findByText(/something went sideways/i)).toBeInTheDocument();
    expect(screen.getByText(/expired before the phone/i)).toBeInTheDocument();
    expect(screen.getByTestId('restart-button')).toBeInTheDocument();
  });

  it('shows the success card when SSE emits session_bound', async () => {
    const session = fakeSession();
    const wire = wireSession(session);

    renderPage();
    await screen.findByTestId('pairing-qr');
    const stream = await wire.waitForSubscription();

    await act(async () => {
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
    const wire = wireSession(session);

    const { unmount } = renderPage();
    await screen.findByTestId('pairing-qr');
    const stream = await wire.waitForSubscription();

    expect(stream.closed).toBe(false);
    unmount();
    expect(stream.closed).toBe(true);
  });

  it('retry button calls createSession again', async () => {
    const session = fakeSession();
    const wire = wireSession(session);

    renderPage();
    await screen.findByTestId('pairing-qr');
    const stream = await wire.waitForSubscription();

    // Drive to the expired card.
    await act(async () => {
      stream.emit({ type: 'session_expired', id: session.id, state: 'expired' });
    });
    const restart = await screen.findByTestId('restart-button');

    vi.mocked(api.pairing.createSession).mockClear();

    await userEvent.click(restart);

    await waitFor(() => expect(api.pairing.createSession).toHaveBeenCalledTimes(1));
    // And the page should be back to a QR render.
    expect(await screen.findByTestId('pairing-qr')).toBeInTheDocument();
  });

  // ─── awaiting_proof: live scanner + paste fallback ────────────

  it('submits the proof when the QrScanner detects a payload (live-scan path)', async () => {
    const session = fakeSession();
    wireSession(session);

    // submitProof resolves so the page transitions to success via the
    // submit response (the SSE path is independently covered above).
    vi.mocked(api.pairing.submitProof).mockResolvedValue({
      session: {
        ...session,
        state: 'bound' as const,
        boundAt: new Date().toISOString(),
        userId: 'u-99',
        did: 'did:zeroauth:demo:scanned',
      },
      tokens: { accessToken: 'jwt-scan', tokenType: 'Bearer', expiresIn: 3600 },
    });

    renderPage();
    await screen.findByTestId('pairing-qr');

    // Walk the user through "phone is scanning" → awaiting_proof.
    await userEvent.click(screen.getByRole('button', { name: /i scanned it/i }));

    // Scanner mock is mounted.
    expect(await screen.findByTestId('qr-scanner-mock')).toBeInTheDocument();

    // Drive the scanner: fire onDetected with a properly-prefixed payload.
    await userEvent.click(screen.getByTestId('qr-scanner-mock-detect'));

    await waitFor(() => expect(api.pairing.submitProof).toHaveBeenCalledTimes(1));
    const submitArgs = vi.mocked(api.pairing.submitProof).mock.calls[0]!;
    expect(submitArgs[0]).toBe(session.id);
    // The page wraps the raw scan into the structured submit body's clientMeta.
    expect(submitArgs[1].clientMeta?.rawScan).toBe('za:proof:1:MOCK-PROOF-PAYLOAD');

    // And the page should now show the success card.
    expect(await screen.findByText(/welcome back/i)).toBeInTheDocument();
  });

  it('submits the proof when the textarea disclosure is used (paste fallback)', async () => {
    const session = fakeSession();
    wireSession(session);

    vi.mocked(api.pairing.submitProof).mockResolvedValue({
      session: {
        ...session,
        state: 'bound' as const,
        boundAt: new Date().toISOString(),
        userId: 'u-100',
        did: 'did:zeroauth:demo:pasted',
      },
      tokens: { accessToken: 'jwt-paste', tokenType: 'Bearer', expiresIn: 3600 },
    });

    renderPage();
    await screen.findByTestId('pairing-qr');
    await userEvent.click(screen.getByRole('button', { name: /i scanned it/i }));

    // The textarea lives inside a <details> disclosure; in jsdom the
    // input is still in the DOM regardless of open/closed, so we can
    // type directly. We don't need to programmatically open the
    // <details> — userEvent typing finds the element by testid.
    const textarea = await screen.findByTestId('proof-payload-input');
    await userEvent.type(textarea, 'za:proof:1:PASTED-PAYLOAD');
    await userEvent.click(screen.getByTestId('proof-submit-button'));

    await waitFor(() => expect(api.pairing.submitProof).toHaveBeenCalledTimes(1));
    const submitArgs = vi.mocked(api.pairing.submitProof).mock.calls[0]!;
    expect(submitArgs[1].clientMeta?.rawScan).toBe('za:proof:1:PASTED-PAYLOAD');
  });
});
