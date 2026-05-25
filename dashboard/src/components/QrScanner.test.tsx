/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QrScanner } from './QrScanner';

// ─── Test doubles for browser APIs ──────────────────────────────
//
// jsdom doesn't ship navigator.mediaDevices or BarcodeDetector, so we
// fully stub both. Each test wires them on `globalThis` before render
// and tears them down in afterEach.

interface FakeTrack {
  stop: () => void;
  stopped: boolean;
}

interface FakeStream {
  tracks: FakeTrack[];
  getTracks(): FakeTrack[];
}

function buildFakeStream(): FakeStream {
  const tracks: FakeTrack[] = [
    { stop() { this.stopped = true; }, stopped: false },
  ];
  return {
    tracks,
    getTracks() {
      return tracks;
    },
  };
}

function installGetUserMedia(impl: (constraints: MediaStreamConstraints) => Promise<unknown>) {
  (navigator as unknown as { mediaDevices: { getUserMedia: typeof impl } }).mediaDevices = {
    getUserMedia: vi.fn(impl),
  };
}

interface DetectHit {
  rawValue: string;
  format: string;
}

interface DetectorOptions {
  /** Hits returned on every detect() call. */
  hits?: DetectHit[];
  /** If set, throw on construct. */
  throwOnConstruct?: boolean;
}

type GlobalWithDetector = typeof globalThis & { BarcodeDetector?: unknown };

function installBarcodeDetector(opts: DetectorOptions = {}) {
  if (opts.throwOnConstruct) {
    class ThrowingCtor {
      constructor() {
        throw new Error('QR not supported');
      }
    }
    (globalThis as GlobalWithDetector).BarcodeDetector = ThrowingCtor;
    return { hitsRef: { current: opts.hits ?? [] } };
  }
  const hitsRef = { current: opts.hits ?? [] };
  class FakeBarcodeDetector {
    detect(): Promise<DetectHit[]> {
      return Promise.resolve(hitsRef.current);
    }
  }
  (globalThis as GlobalWithDetector).BarcodeDetector = FakeBarcodeDetector;
  return { hitsRef };
}

function uninstallBarcodeDetector() {
  delete (globalThis as GlobalWithDetector).BarcodeDetector;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // HTMLMediaElement.play is not implemented in jsdom; stub to a resolved
  // promise so the scanner's `await video.play()` resolves cleanly.
  if (!(HTMLMediaElement.prototype as unknown as { play?: unknown }).play) {
    (HTMLMediaElement.prototype as unknown as { play: () => Promise<void> }).play = vi
      .fn()
      .mockResolvedValue(undefined);
  } else {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  }
  // Force the video to report HAVE_CURRENT_DATA so the tick loop reads
  // pixels. jsdom defaults readyState to 0.
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    configurable: true,
    get: () => 4,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    get: () => 640,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    get: () => 480,
  });
  // canvas 2D context returns null in jsdom; stub it so drawImage exists.
  (
    HTMLCanvasElement.prototype as unknown as { getContext: () => { drawImage: () => void } }
  ).getContext = vi.fn(() => ({
    drawImage: vi.fn(),
  }));
});

afterEach(() => {
  uninstallBarcodeDetector();
  delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────

describe('<QrScanner />', () => {
  it('renders the video element while initializing the camera', async () => {
    installBarcodeDetector();
    installGetUserMedia(async () => buildFakeStream());

    render(<QrScanner onDetected={() => {}} expectedPrefix="za:proof:1:" />);

    expect(screen.getByTestId('qr-scanner-video')).toBeInTheDocument();
    // Status pill is present (with whatever phase we're in).
    expect(await screen.findByTestId('qr-scanner-status')).toBeInTheDocument();
  });

  it('calls onDetected with the decoded text on a matching prefix', async () => {
    installBarcodeDetector({ hits: [{ rawValue: 'za:proof:1:abc123', format: 'qr_code' }] });
    installGetUserMedia(async () => buildFakeStream());

    const onDetected = vi.fn();
    render(<QrScanner onDetected={onDetected} expectedPrefix="za:proof:1:" />);

    // Allow the scanner to mount + reach scanning state + run a tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    // Then walk past the freeze-hold so the timeout fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('za:proof:1:abc123'));
    expect(onDetected).toHaveBeenCalledTimes(1);
  });

  it('ignores decoded QRs that do not match the expectedPrefix', async () => {
    installBarcodeDetector({ hits: [{ rawValue: 'https://example.com', format: 'qr_code' }] });
    installGetUserMedia(async () => buildFakeStream());

    const onDetected = vi.fn();
    render(<QrScanner onDetected={onDetected} expectedPrefix="za:proof:1:" />);

    // Let the scanner run several detection ticks.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(onDetected).not.toHaveBeenCalled();
    // And we're still in the looking state.
    expect(screen.getByTestId('qr-scanner-status')).toHaveTextContent(/Looking|Starting/i);
  });

  it('calls onError + shows retry when getUserMedia is denied', async () => {
    installBarcodeDetector();
    installGetUserMedia(async () => {
      const e = new Error('Permission denied');
      e.name = 'NotAllowedError';
      throw e;
    });

    const onError = vi.fn();
    render(<QrScanner onDetected={() => {}} onError={onError} expectedPrefix="za:proof:1:" />);

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    const retry = await screen.findByTestId('qr-scanner-retry');
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveTextContent(/allow camera/i);

    // Clicking retry re-runs the effect (still failing in this test —
    // we only verify it tries again).
    await userEvent.click(retry);
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
  });

  it('shows the unsupported state + fires onUnsupported when BarcodeDetector is missing', async () => {
    uninstallBarcodeDetector();
    installGetUserMedia(async () => buildFakeStream());

    const onUnsupported = vi.fn();
    render(
      <QrScanner
        onDetected={() => {}}
        expectedPrefix="za:proof:1:"
        onUnsupported={onUnsupported}
      />,
    );

    expect(await screen.findByTestId('qr-scanner-unsupported')).toBeInTheDocument();
    expect(onUnsupported).toHaveBeenCalled();
  });

  it('stops all stream tracks + clears the interval on unmount', async () => {
    installBarcodeDetector();
    const fakeStream = buildFakeStream();
    installGetUserMedia(async () => fakeStream);

    const { unmount } = render(<QrScanner onDetected={() => {}} expectedPrefix="za:proof:1:" />);

    // Let the scanner reach `scanning` so the interval is running.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(fakeStream.tracks[0]!.stopped).toBe(false);
    unmount();
    expect(fakeStream.tracks[0]!.stopped).toBe(true);
  });
});
