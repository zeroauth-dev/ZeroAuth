/**
 * VerificationsView — live-stream skeleton tests.
 *
 * Six assertion blocks:
 *
 *   1. Empty state — before any event lands, the view shows
 *      "Waiting for live verifications…" + a spinner.
 *
 *   2. Render — feeding three synthetic events through the
 *      mocked stream renders three table rows.
 *
 *   3. Counter — feeding the five-row fixture set (3 successes,
 *      2 failures) drives the per-session counters to the
 *      expected totals.
 *
 *   4. PII absence — none of the SENSITIVE_LEAK_PROBES substrings
 *      appear in the rendered DOM. Includes a regex sweep for
 *      Indian-style phone patterns ("+91 …"). Same shape as the
 *      users-view test at commit `6e06a14`.
 *
 *   5. Source-file property reads — the component file itself
 *      contains zero textual references to `.full_name`,
 *      `.email`, `.phone`. The grep guard is defence in depth
 *      against a future refactor that bridges surfaces.
 *
 *   6. Stream lifecycle — the stream's close handle is called on
 *      unmount so the EventSource never leaks past the view.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { VerificationsView } from '../verifications';
import type { VerificationEvent } from '../../../lib/verifications-api';
import {
  fakeVerifications,
  SENSITIVE_LEAK_PROBES,
  FORBIDDEN_FIELD_READS,
} from './verifications.fixtures';

// ─── Stream-opener mock ──────────────────────────────────────────
//
// The view accepts a `streamOpener` prop for testability. We hand
// it a controllable opener that captures the consumer's `onEvent`
// in a ref so the test can drive events deterministically. The
// opener also exposes the close spy so the lifecycle assertion can
// verify cleanup on unmount.

interface StreamHarness {
  pushEvent: (event: VerificationEvent) => void;
  pushError: (code: string, message: string) => void;
  closeSpy: ReturnType<typeof vi.fn>;
  openCount: number;
  /** The streamOpener prop to pass into the view. */
  opener: (
    onEvent: (event: VerificationEvent) => void,
    options?: { onError?: (code: string, message: string) => void },
  ) => { close: () => void };
}

function createStreamHarness(): StreamHarness {
  let consumer: ((event: VerificationEvent) => void) | null = null;
  let errorConsumer: ((code: string, message: string) => void) | null = null;
  const closeSpy = vi.fn();
  let openCount = 0;
  const opener: StreamHarness['opener'] = (onEvent, options) => {
    consumer = onEvent;
    errorConsumer = options?.onError ?? null;
    openCount += 1;
    return { close: closeSpy };
  };
  return {
    pushEvent: (event) => {
      if (!consumer) throw new Error('Stream not open — push called before subscribe');
      // Wrap in act() so React's state update flushes before the
      // test's next assertion. Skipping act() leaves the rendered
      // DOM in a "before commit" state and the test reads stale.
      act(() => {
        consumer!(event);
      });
    },
    pushError: (code, message) => {
      if (errorConsumer) {
        act(() => {
          errorConsumer!(code, message);
        });
      }
    },
    closeSpy,
    get openCount() {
      return openCount;
    },
    opener,
  };
}

// ─── Render helper ──────────────────────────────────────────────

function renderView(harness: StreamHarness) {
  return render(<VerificationsView streamOpener={harness.opener} />);
}

// ─── Tests ──────────────────────────────────────────────────────

describe('<VerificationsView />', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Assertion 1 — empty state ────────────────────────────────

  it('renders the "Waiting for live verifications" empty state before any event lands', () => {
    const harness = createStreamHarness();
    renderView(harness);

    expect(screen.getByText(/waiting for live verifications/i)).toBeInTheDocument();
    expect(screen.getByTestId('verifications-waiting-spinner')).toBeInTheDocument();
    // Counter row exists, but every count is zero.
    expect(
      screen.getByTestId('verifications-counter-success-value').textContent,
    ).toBe('0');
    expect(
      screen.getByTestId('verifications-counter-failure-value').textContent,
    ).toBe('0');
    expect(
      screen.getByTestId('verifications-counter-total-value').textContent,
    ).toBe('0');
  });

  // ── Assertion 2 — three events → three rows ──────────────────

  it('renders one table row per pushed event (3 events → 3 rows)', () => {
    const harness = createStreamHarness();
    renderView(harness);

    const three = fakeVerifications.slice(0, 3);
    for (const e of three) harness.pushEvent(e);

    const rows = screen.getAllByTestId('verifications-row');
    expect(rows).toHaveLength(3);

    // Newest first — the first row should be the LAST pushed event
    // (the view prepends with the spread + slice idiom).
    const last = three[three.length - 1]!;
    const didCells = screen.getAllByTestId('verifications-row-did');
    expect(didCells[0]?.textContent ?? '').toContain(last.did.slice(0, 16));
  });

  // ── Assertion 3 — counters ──────────────────────────────────

  it('counter row updates as events land (3 success + 2 failure from the 5-row fixture)', () => {
    const harness = createStreamHarness();
    renderView(harness);

    for (const e of fakeVerifications) harness.pushEvent(e);

    // The fixture set is 3 successes + 2 failures = 5 total.
    expect(
      screen.getByTestId('verifications-counter-success-value').textContent,
    ).toBe('3');
    expect(
      screen.getByTestId('verifications-counter-failure-value').textContent,
    ).toBe('2');
    expect(
      screen.getByTestId('verifications-counter-total-value').textContent,
    ).toBe('5');
  });

  // ── Assertion 4 — PII absence ────────────────────────────────

  it('never renders any of the sensitive PII probes after pushing the fixture set', () => {
    const harness = createStreamHarness();
    const { container } = renderView(harness);

    for (const e of fakeVerifications) harness.pushEvent(e);

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

  // ── Assertion 5 — source-file property-read scan ─────────────

  it('verifications.tsx contains zero textual references to PII property reads', () => {
    // Resolve the component source path relative to this test file.
    const componentPath = path.resolve(__dirname, '../verifications.tsx');
    const src = fs.readFileSync(componentPath, 'utf8');

    // Strip the leading docstring before the scan — the file's
    // header doc deliberately names the forbidden fields as the
    // "must not appear" allowlist guidance, and we want to
    // preserve that documentation. Everything after the first
    // top-level `import` is real code.
    const firstImport = src.indexOf('\nimport ');
    const codeOnly = firstImport > 0 ? src.slice(firstImport) : src;

    for (const forbidden of FORBIDDEN_FIELD_READS) {
      expect(
        codeOnly,
        `verifications.tsx code body must not contain the substring "${forbidden}".`,
      ).not.toContain(forbidden);
    }
  });

  // ── Assertion 6 — stream lifecycle ──────────────────────────

  it('closes the stream on unmount', () => {
    const harness = createStreamHarness();
    const { unmount } = renderView(harness);

    expect(harness.openCount).toBeGreaterThanOrEqual(1);
    expect(harness.closeSpy).not.toHaveBeenCalled();

    unmount();

    // close() may be invoked more than once under React 19 StrictMode
    // double-effects, but it MUST be invoked at least once.
    expect(harness.closeSpy).toHaveBeenCalled();
  });

  // ── Assertion 7 — stream error surfaces a banner ────────────

  it('renders the stream-error banner when the opener reports an error', () => {
    const harness = createStreamHarness();
    renderView(harness);

    harness.pushError('sse_disconnected', 'Lost the connection to the verifications stream.');

    expect(screen.getByTestId('verifications-stream-error')).toBeInTheDocument();
    expect(
      screen.getByText(/lost the connection to the verifications stream/i),
    ).toBeInTheDocument();
  });
});
