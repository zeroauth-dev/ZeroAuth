/**
 * Kiosk route descriptor (precursor to C-147 sprint 2).
 *
 * The integration commit that wires the kiosk into the dashboard
 * router picks this up and lazy-loads ./Kiosk. Until then the route is
 * intentionally NOT registered in src/App.tsx — the skeleton lives
 * stand-alone so design + UX can iterate on it without colliding with
 * the main routing surface.
 *
 * Path shape:
 *
 *   /kiosk/:tenant?session=...
 *
 * The `:tenant` path segment is the public tenant id (e.g.
 * `anchor-bank-demo`); the optional `session` query string lets the
 * operator console pre-mint a kiosk session id, useful for the run-
 * through demo where the operator wants the QR up before walking on
 * stage. When omitted the component mints a fresh session on mount.
 *
 * The reason this lives in a TS file (not just a string constant
 * inlined in App.tsx) is that the sprint-2 integration commit will
 * import the path + lazy-loader pair as a unit; keeping them together
 * avoids the "two PRs touched the same line of App.tsx" merge churn.
 */

export const KIOSK_ROUTE_PATH = '/kiosk/:tenant';

/**
 * Lazy loader the App router will pull when the route is wired in
 * sprint 2. Kept as a function rather than a top-level `lazy(() =>
 * import(…))` so consumers can wrap it in their own <Suspense> /
 * <Outlet> structure without coupling to React in this file.
 */
export function loadKioskComponent(): Promise<{ default: React.ComponentType }> {
  return import('./Kiosk');
}

/**
 * Compact descriptor a future routing-config file can map over without
 * having to hard-code the string in two places.
 */
export const kioskRouteDescriptor = {
  path: KIOSK_ROUTE_PATH,
  load: loadKioskComponent,
  // Public route — the kiosk runs on a screen visible to the bank
  // floor, no console JWT is required for the page render itself.
  // The SSE stream still cookie-auths against the operator's open
  // browser session (per ADR 0013), so the kiosk page is meant to be
  // opened in a browser tab the operator has already logged into.
  requiresAuth: false,
} as const;

export type KioskRouteDescriptor = typeof kioskRouteDescriptor;
