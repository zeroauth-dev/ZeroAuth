/**
 * useSession() — the demo-portal's session hook.
 *
 * Reads /api/demo-portal/me, caches the result at module level so
 * every mount (AppShell + a route) sees the same value at the same
 * React tick, and exposes `logout()` + `refresh()`.
 *
 * Module-level state (not React Context) because the consumer count
 * is tiny and a Context provider would force the whole tree to
 * re-render on every status flip. Shared via a tiny pub/sub — same
 * trick the dashboard's ToastViewport uses.
 *
 * No React Query: demo-portal does not ship it as a dep. If we ever
 * need invalidation/refetch on focus, swap this internal cache for
 * useQuery and keep the same exported hook shape.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type DemoSession } from './api';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionState {
  status: SessionStatus;
  session: DemoSession | null;
  /** Last non-401 fetch error. 401 is the steady "signed out" state, not an error. */
  error: string | null;
}

export interface UseSessionResult extends SessionState {
  /** POST /api/demo-portal/logout and clear the cache. Does not navigate. */
  logout: () => Promise<void>;
  /** Re-hit /me; useful after the QR-scan completes server-side. */
  refresh: () => Promise<void>;
}

// ─── Module-level cache + pub/sub ─────────────────────────────────

const INITIAL_STATE: SessionState = {
  status: 'loading',
  session: null,
  error: null,
};

let cachedState: SessionState = INITIAL_STATE;
const listeners = new Set<(s: SessionState) => void>();

// Coalesce simultaneous /me requests (AppShell + a route mount on the
// same tick). Cleared on settle so the next manual refresh starts fresh.
let inflightMe: Promise<void> | null = null;

function publish(next: SessionState): void {
  cachedState = next;
  for (const fn of listeners) fn(next);
}

async function fetchMe(): Promise<void> {
  if (inflightMe) return inflightMe;
  inflightMe = (async () => {
    try {
      const session = await api.getMe();
      publish({ status: 'authenticated', session, error: null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // 401 = no cookie / cookie expired. That is the unauthenticated
        // steady state, not an error worth surfacing in the UI.
        publish({ status: 'unauthenticated', session: null, error: null });
      } else {
        const message = err instanceof ApiError ? err.message : (err as Error).message;
        publish({ status: 'unauthenticated', session: null, error: message });
      }
    } finally {
      inflightMe = null;
    }
  })();
  return inflightMe;
}

// ─── Hook ─────────────────────────────────────────────────────────

export function useSession(): UseSessionResult {
  // Seed from the shared cache so a consumer mounting AFTER the
  // initial fetch does not flash 'loading'.
  const [state, setState] = useState<SessionState>(cachedState);

  useEffect(() => {
    listeners.add(setState);
    if (cachedState.status === 'loading') {
      void fetchMe();
    }
    return () => {
      listeners.delete(setState);
    };
  }, []);

  const refresh = useCallback(async () => {
    publish({ ...cachedState, status: 'loading' });
    await fetchMe();
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (err) {
      // A 401 here just means the server already lost the cookie —
      // we're about to clear the same local state anyway. Other errors
      // we log but still clear, because the user's intent is "sign out".
      if (!(err instanceof ApiError && err.status === 401)) {
        // eslint-disable-next-line no-console
        console.warn('[useSession] logout failed; clearing local session anyway', err);
      }
    }
    publish({ status: 'unauthenticated', session: null, error: null });
  }, []);

  return {
    status: state.status,
    session: state.session,
    error: state.error,
    logout,
    refresh,
  };
}

// ─── Test-only escape hatch ───────────────────────────────────────

/**
 * Reset the module-level cache. Vitest tests need a clean slate
 * between cases; production code MUST NOT call this.
 * @internal
 */
export function _resetSessionCacheForTests(): void {
  cachedState = INITIAL_STATE;
  inflightMe = null;
  for (const fn of listeners) fn(INITIAL_STATE);
}

export default useSession;
