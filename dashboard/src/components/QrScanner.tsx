import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui';
import { cn } from '../lib/cn';

/**
 * QrScanner — a self-contained webcam QR reader.
 *
 * Decoder choice: native `BarcodeDetector` (Chromium + Safari 17+, zero
 * bundle cost). If the browser doesn't expose it, the component renders
 * an `unsupported` empty state and surfaces that fact via
 * `onUnsupported`. The parent (QrProofLogin) keeps its paste-text
 * fallback as the accessibility + unsupported-browser path.
 *
 * Lifecycle:
 *   - On mount, request a user-facing camera stream via
 *     `getUserMedia({ video: { facingMode: 'user' } })`.
 *   - Tick a `requestAnimationFrame`-driven loop (250 ms cadence) that
 *     draws the latest frame to an off-screen canvas and runs
 *     `BarcodeDetector.detect`. Cadence keeps CPU low on idle backgrounds.
 *   - First match wins: stop the stream + the loop, freeze the last
 *     frame on the video element, and fire `onDetected`. After the
 *     freeze interval, the parent transitions to its next state.
 *   - On unmount, stop all tracks and clear the loop. The page can be
 *     navigated away or torn down at any state.
 *
 * Accessibility:
 *   - The video element has `aria-label` and the overlay viewfinder is
 *     `aria-hidden`.
 *   - The status pill below the viewfinder is a `role="status"` live
 *     region so screen readers hear "Looking for code…" → "Detected".
 */

// BarcodeDetector is a Web API that TypeScript's lib.dom.d.ts doesn't
// ship yet (as of TS 5.9). We declare the minimum shape we use.
interface BarcodeDetectorLike {
  detect(source: HTMLCanvasElement | HTMLVideoElement | ImageBitmap | ImageData):
    Promise<Array<{ rawValue: string; format: string }>>;
}
interface BarcodeDetectorCtor {
  new (init?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor ?? null;
}

export interface QrScannerProps {
  onDetected: (text: string) => void;
  onError?: (err: Error) => void;
  /** When provided, the scanner ignores QRs whose decoded text doesn't start with this prefix. */
  expectedPrefix?: string;
  /** Fires once on mount if the browser lacks BarcodeDetector. The parent can swap in a fallback. */
  onUnsupported?: () => void;
  width?: number;
  height?: number;
  className?: string;
}

type ScannerState =
  | { kind: 'initializing' }
  | { kind: 'scanning' }
  | { kind: 'detected' }
  | { kind: 'permission_denied'; message: string }
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

const DETECT_INTERVAL_MS = 250;
// How long we hold the frozen last frame before unmounting the camera, so
// the operator visibly sees that "yes, the QR was caught".
const FREEZE_HOLD_MS = 600;

export function QrScanner({
  onDetected,
  onError,
  expectedPrefix,
  onUnsupported,
  width = 480,
  height = 360,
  className,
}: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  // Latch so we never fire onDetected twice or race a teardown.
  const detectedRef = useRef(false);
  const [state, setState] = useState<ScannerState>({ kind: 'initializing' });
  // Bump this to retry after a permission-denied without remounting the
  // whole component (preserves the parent's state machine).
  const [attempt, setAttempt] = useState(0);

  const stopEverything = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // best-effort
        }
      }
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    detectedRef.current = false;

    const Ctor = getBarcodeDetectorCtor();
    if (!Ctor) {
      setState({ kind: 'unsupported' });
      onUnsupported?.();
      return () => {
        cancelled = true;
      };
    }

    try {
      detectorRef.current = new Ctor({ formats: ['qr_code'] });
    } catch (err) {
      // Some Chromium builds expose the constructor but throw when QR
      // isn't in the supported set. Treat as unsupported.
      setState({ kind: 'unsupported' });
      onUnsupported?.();
      onError?.(err instanceof Error ? err : new Error(String(err)));
      return () => {
        cancelled = true;
      };
    }

    setState({ kind: 'initializing' });

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: width }, height: { ideal: height } },
          audio: false,
        });
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // play() returns a Promise that rejects in some browsers if the
          // tab isn't active. Swallow — the next interval tick still
          // works because srcObject is set.
          try {
            await video.play();
          } catch {
            // best-effort
          }
        }
        setState({ kind: 'scanning' });

        intervalRef.current = setInterval(() => {
          void tick();
        }, DETECT_INTERVAL_MS);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        const denied = /Permission|NotAllowed|denied/i.test(e.name + ' ' + e.message);
        if (denied) {
          setState({ kind: 'permission_denied', message: 'Camera access was denied. Allow access and try again.' });
        } else {
          setState({ kind: 'error', message: e.message || 'Camera unavailable.' });
        }
        onError?.(e);
      }
    })();

    async function tick() {
      if (detectedRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const detector = detectorRef.current;
      if (!video || !canvas || !detector) return;
      if (video.readyState < 2) return; // HAVE_CURRENT_DATA
      // Match the actual displayed size so the detector sees the same
      // pixels as the operator (avoids letterbox confusion on weird
      // aspect ratios).
      const vw = video.videoWidth || width;
      const vh = video.videoHeight || height;
      if (canvas.width !== vw) canvas.width = vw;
      if (canvas.height !== vh) canvas.height = vh;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, vw, vh);
      let hits: Array<{ rawValue: string; format: string }> = [];
      try {
        hits = await detector.detect(canvas);
      } catch (err) {
        // BarcodeDetector occasionally throws on torn frames; ignore and
        // retry on the next tick rather than surfacing transient noise.
        void err;
        return;
      }
      if (detectedRef.current) return;
      for (const hit of hits) {
        const text = (hit?.rawValue ?? '').trim();
        if (!text) continue;
        if (expectedPrefix && !text.startsWith(expectedPrefix)) continue;
        detectedRef.current = true;
        setState({ kind: 'detected' });
        // Stop the loop right now so we don't fire twice while the
        // freeze hold elapses, but DON'T drop the stream — the operator
        // sees the last frozen frame for the hold interval.
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setTimeout(() => {
          stopEverything();
          onDetected(text);
        }, FREEZE_HOLD_MS);
        return;
      }
    }

    return () => {
      cancelled = true;
      stopEverything();
    };
    // We intentionally rerun on `attempt` (retry button), and don't
    // depend on the callbacks so a parent re-render doesn't tear down
    // the camera mid-scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Final unmount cleanup (defence-in-depth against the effect cleanup
  // being deferred under React 19 strict mode).
  useEffect(() => () => stopEverything(), [stopEverything]);

  // ─── Render ─────────────────────────────────────────────────────

  if (state.kind === 'unsupported') {
    return (
      <div
        data-testid="qr-scanner-unsupported"
        className={cn(
          'flex items-center justify-center rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-6 text-center text-xs text-[var(--color-text-dim)]',
          className,
        )}
        style={{ minHeight: height / 2 }}
      >
        Your browser can&apos;t scan QRs natively. Paste the code from your phone instead.
      </div>
    );
  }

  if (state.kind === 'permission_denied' || state.kind === 'error') {
    return (
      <div
        data-testid="qr-scanner-error"
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4 py-8 text-center text-xs text-[var(--color-text-secondary)]',
          className,
        )}
        style={{ minHeight: height / 2 }}
      >
        <p className="max-w-xs">{state.message}</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid="qr-scanner-retry"
          onClick={() => setAttempt((n) => n + 1)}
        >
          {state.kind === 'permission_denied' ? 'Allow camera access' : 'Try again'}
        </Button>
      </div>
    );
  }

  const statusLabel =
    state.kind === 'detected'
      ? 'QR detected, verifying…'
      : state.kind === 'scanning'
        ? 'Looking for code…'
        : 'Starting camera…';

  return (
    <div
      className={cn('flex flex-col items-center gap-2', className)}
      data-testid="qr-scanner"
    >
      <div
        className="relative overflow-hidden rounded-lg border border-[var(--color-border)] bg-black"
        style={{ width, height }}
      >
        <video
          ref={videoRef}
          // user-facing webcam — flip horizontally so the operator's
          // motions match the on-screen preview (mirror selfie cam).
          style={{ transform: 'scaleX(-1)', width: '100%', height: '100%', objectFit: 'cover' }}
          playsInline
          muted
          autoPlay
          aria-label="Webcam preview for QR scanning"
          data-testid="qr-scanner-video"
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />
        {/* Viewfinder overlay — pure CSS, no decoding role. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div
            className={cn(
              'relative rounded-md',
              state.kind === 'detected'
                ? 'border-2 border-[var(--color-success)]'
                : 'border-2 border-white/70',
            )}
            style={{ width: Math.min(width, height) * 0.6, height: Math.min(width, height) * 0.6 }}
          >
            {/* Corner ticks */}
            {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
              <span
                key={c}
                className={cn(
                  'absolute size-4 border-current',
                  c === 'tl' && 'left-0 top-0 border-l-2 border-t-2',
                  c === 'tr' && 'right-0 top-0 border-r-2 border-t-2',
                  c === 'bl' && 'left-0 bottom-0 border-l-2 border-b-2',
                  c === 'br' && 'right-0 bottom-0 border-r-2 border-b-2',
                  state.kind === 'detected'
                    ? 'text-[var(--color-success)]'
                    : 'text-white',
                )}
              />
            ))}
          </div>
        </div>
      </div>
      <div
        role="status"
        aria-live="polite"
        data-testid="qr-scanner-status"
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium',
          state.kind === 'detected'
            ? 'border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]'
            : 'border-[var(--color-border)] bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)]',
        )}
      >
        <span
          className={cn(
            'inline-block size-2 rounded-full',
            state.kind === 'detected'
              ? 'bg-[var(--color-success)]'
              : 'animate-pulse bg-[var(--color-text-dim)]',
          )}
        />
        {statusLabel}
      </div>
    </div>
  );
}

export default QrScanner;
