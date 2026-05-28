import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Kiosk from '../Kiosk';
import {
  ANCHOR_BANK_TENANT,
  makeKioskSession,
  makeReissuedKioskSession,
} from './Kiosk.fixtures';

// We mock the whole api module so we own the createSession + pairing
// promise behaviour. The dashboard's existing api.pairing.subscribeStream
// is NOT exercised by Kiosk — Kiosk builds its own EventSource per
// ADR 0013 — so we don't need to mock it.
vi.mock('../../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/api')>('../../../lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      pairing: {
        ...actual.api.pairing,
        createSession: vi.fn(),
      },
    },
  };
});

// We mock useNavigate at the react-router-dom layer so we can assert
// the kiosk's redirect target without coupling to <Routes> matching.
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

import { api } from '../../../lib/api';

// ─── EventSource mock ───────────────────────────────────────────
//
// jsdom doesn't ship EventSource, so the kiosk's `openKioskStream` early-
// returns in tests by default. We install a controllable replacement on
// `globalThis.EventSource` that captures every constructed instance so
// the test can fire named events at it through `mockEs.dispatch(...)`.

interface MockEventSourceInstance {
  url: string;
  init: EventSourceInit | undefined;
  readyState: number;
  closed: boolean;
  listeners: Map<string, Set<(ev: Event) => void>>;
  dispatch: (eventName: string, payload?: Record<string, unknown>) => void;
  close: () => void;
}

const eventSourceInstances: MockEventSourceInstance[] = [];

class MockEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState: number = MockEventSource.OPEN;
  url: string;
  withCredentials: boolean;
  onerror: ((this: EventSource, ev: Event) => void) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => void) | null = null;
  onopen: ((this: EventSource, ev: Event) => void) | null = null;
  private listeners: Map<string, Set<(ev: Event) => void>> = new Map();
  private _instance: MockEventSourceInstance;

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    this._instance = {
      url,
      init,
      readyState: this.readyState,
      closed: false,
      listeners: this.listeners,
      dispatch: (eventName: string, payload?: Record<string, unknown>) => {
        const set = this.listeners.get(eventName);
        if (!set) return;
        const ev = new MessageEvent(eventName, {
          data: payload ? JSON.stringify(payload) : '',
        });
        for (const handler of set) handler(ev);
      },
      close: () => {
        this.close();
      },
    };
    eventSourceInstances.push(this._instance);
  }

  addEventListener(name: string, handler: (ev: Event) => void) {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(handler);
  }

  removeEventListener(name: string, handler: (ev: Event) => void) {
    this.listeners.get(name)?.delete(handler);
  }

  close() {
    this.readyState = MockEventSource.CLOSED;
    this._instance.closed = true;
    this._instance.readyState = MockEventSource.CLOSED;
    this.listeners.clear();
  }
}

// ─── Test harness ───────────────────────────────────────────────

function renderKiosk(initialSearch = `?tenantId=${ANCHOR_BANK_TENANT.id}`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/kiosk/${ANCHOR_BANK_TENANT.id}${initialSearch}`]}>
        <Routes>
          <Route path={`/kiosk/${ANCHOR_BANK_TENANT.id}`} element={<Kiosk />} />
          <Route path="/anchor-bank/landing" element={<div>Landing page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function waitForEventSource(): Promise<MockEventSourceInstance> {
  await waitFor(() => {
    if (eventSourceInstances.length === 0) {
      throw new Error('no EventSource opened yet');
    }
  });
  return eventSourceInstances[eventSourceInstances.length - 1]!;
}

// ─── Fixture spies ──────────────────────────────────────────────

beforeEach(() => {
  // Install the EventSource mock fresh per test.
  (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
    MockEventSource as unknown as typeof EventSource;
  eventSourceInstances.length = 0;
  navigateMock.mockReset();
  vi.mocked(api.pairing.createSession).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────

describe('<Kiosk />', () => {
  it('renders the QR placeholder once the session POST resolves', async () => {
    const session = makeKioskSession();
    // Defer the resolution so the test can observe the pre-resolution
    // spinner deterministically — `mockResolvedValue` would otherwise
    // settle in the same microtask that the component renders in, and
    // the spinner never lands in the DOM long enough to be queried.
    let resolveCreate: (value: { session: typeof session }) => void = () => {};
    const pending = new Promise<{ session: typeof session }>((resolve) => {
      resolveCreate = resolve;
    });
    vi.mocked(api.pairing.createSession).mockReturnValueOnce(pending);

    renderKiosk();

    // Pre-resolution we render the spinner.
    expect(await screen.findByTestId('kiosk-spinner')).toBeInTheDocument();

    await act(async () => {
      resolveCreate({ session });
    });

    // After resolution the QR panel + tagline land.
    const qrPanel = await screen.findByTestId('kiosk-qr-panel');
    expect(qrPanel).toBeInTheDocument();
    expect(screen.getByTestId('kiosk-qr')).toBeInTheDocument();
    expect(screen.getByTestId('kiosk-tagline')).toHaveTextContent(
      /scan with your zeroauth app to sign in/i,
    );
    expect(api.pairing.createSession).toHaveBeenCalledTimes(1);
    expect(api.pairing.createSession).toHaveBeenCalledWith({ environment: 'live' });
  });

  it('exposes session_nonce + tenant + expires_at on the QR panel for the bound payload', async () => {
    const session = makeKioskSession({ expiresAt: '2030-01-01T00:00:00.000Z' });
    vi.mocked(api.pairing.createSession).mockResolvedValue({ session });

    renderKiosk(`?tenantId=${ANCHOR_BANK_TENANT.id}`);

    const qrPanel = await screen.findByTestId('kiosk-qr-panel');

    // tenant + expires_at come straight from the host page + server.
    expect(qrPanel.getAttribute('data-tenant')).toBe(ANCHOR_BANK_TENANT.id);
    expect(qrPanel.getAttribute('data-expires-at')).toBe('2030-01-01T00:00:00.000Z');

    // session_nonce is the 32-byte hex the kiosk minted on mount.
    const nonceAttr = qrPanel.getAttribute('data-session-nonce');
    expect(nonceAttr).toBeTruthy();
    expect(nonceAttr).toMatch(/^[0-9a-f]{64}$/);
  });

  it('navigates to the anchor-bank landing on pairing.consumed', async () => {
    const session = makeKioskSession();
    vi.mocked(api.pairing.createSession).mockResolvedValue({ session });

    renderKiosk();

    await screen.findByTestId('kiosk-qr-panel');
    const es = await waitForEventSource();

    // Sanity: the kiosk uses cookie auth (no `?access_token=` query).
    expect(es.url).toBe(
      `/api/console/proof-pairing/sessions/${encodeURIComponent(session.id)}/stream`,
    );
    expect(es.url).not.toContain('access_token');
    expect(es.init?.withCredentials).toBe(true);

    await act(async () => {
      es.dispatch('pairing.consumed', { id: session.id });
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/anchor-bank/landing');
    });
  });

  it('regenerates a fresh session on pairing.expired', async () => {
    const initial = makeKioskSession();
    const reissued = makeReissuedKioskSession();
    vi.mocked(api.pairing.createSession)
      .mockResolvedValueOnce({ session: initial })
      .mockResolvedValueOnce({ session: reissued });

    renderKiosk();

    await screen.findByTestId('kiosk-qr-panel');
    const firstEs = await waitForEventSource();
    expect(firstEs.url).toContain(initial.id);

    // Fire the expiry event — kiosk should silently mint a new session
    // and the next EventSource construction lands on the reissued id.
    await act(async () => {
      firstEs.dispatch('pairing.expired', { id: initial.id });
    });

    await waitFor(() => {
      expect(api.pairing.createSession).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      const last = eventSourceInstances[eventSourceInstances.length - 1]!;
      expect(last.url).toContain(reissued.id);
    });

    // No "session expired" error card flashes on screen — the rotation
    // is invisible to the bank floor.
    expect(screen.queryByTestId('kiosk-error')).not.toBeInTheDocument();
  });

  // ─── Belt-and-braces: error path ─────────────────────────────
  //
  // Not one of the four required tests, but cheap to assert: when
  // createSession outright fails, the operator-recoverable error
  // panel renders + the retry button calls createSession again. Keeps
  // the kiosk skeleton's error surface from rotting in sprint 2.

  it('shows the recoverable error panel when the session POST rejects', async () => {
    vi.mocked(api.pairing.createSession).mockRejectedValueOnce({
      code: 'pairing_create_failed',
      message: 'Backend unreachable.',
    });

    renderKiosk();

    expect(await screen.findByTestId('kiosk-error')).toBeInTheDocument();
    expect(screen.getByText(/backend unreachable/i)).toBeInTheDocument();

    // Now wire the next resolution + click retry.
    const session = makeKioskSession();
    vi.mocked(api.pairing.createSession).mockResolvedValueOnce({ session });

    await userEvent.click(screen.getByTestId('kiosk-retry'));

    await waitFor(() => {
      expect(api.pairing.createSession).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByTestId('kiosk-qr-panel')).toBeInTheDocument();
  });
});
