import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  api,
  ApiError,
  type RegistrationSession,
} from '../../lib/api';
import { useEnvironment } from '../../components/layout/AppShell';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CopyButton,
  Input,
  Label,
  pushToast,
  Skeleton,
} from '../../components/ui';
import { cn } from '../../lib/cn';

/**
 * Three-QR end-user signup ceremony demo (ADR 0023).
 *
 * The platform (left column) opens a session, then walks the
 * operator through three QRs. The right column is a "Simulate
 * phone" panel that exercises the phone-side endpoints directly —
 * the operator can drive the ceremony end-to-end from one browser
 * window without an actual companion app.
 *
 * In production the phone hits the same endpoints via /v1/registrations/*
 * on the public origin, scanning each QR with its camera. The
 * deeplinks rendered into the QRs (`zeroauth://reg?step=…`) are the
 * canonical format the companion app handles.
 */

// ─── State machine ────────────────────────────────────────────────

type Phase =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | {
      kind: 'awaiting_device';
      session: RegistrationSession;
      pairCode: string;
      pairDeeplink: string;
      pairExpiresAt: string;
    }
  | {
      kind: 'awaiting_commitment';
      session: RegistrationSession;
      enrollCode: string;
      enrollDeeplink: string;
      enrollExpiresAt: string;
    }
  | {
      kind: 'awaiting_verification';
      session: RegistrationSession;
      verifyCode: string;
      verifyDeeplink: string;
      verifyExpiresAt: string;
      challengeNonce: string;
    }
  | {
      kind: 'completed';
      session: RegistrationSession;
      tenantUserId: string;
    }
  | { kind: 'error'; message: string };

type Action =
  | { type: 'create_start' }
  | { type: 'create_ok'; session: RegistrationSession; pairCode: string; pairDeeplink: string; pairExpiresAt: string }
  | { type: 'paired'; session: RegistrationSession; enrollCode: string; enrollDeeplink: string; enrollExpiresAt: string }
  | { type: 'committed'; session: RegistrationSession; verifyCode: string; verifyDeeplink: string; verifyExpiresAt: string; challengeNonce: string }
  | { type: 'completed'; session: RegistrationSession; tenantUserId: string }
  | { type: 'failed'; message: string }
  | { type: 'reset' };

function reducer(state: Phase, action: Action): Phase {
  switch (action.type) {
    case 'create_start':
      return { kind: 'creating' };
    case 'create_ok':
      return {
        kind: 'awaiting_device',
        session: action.session,
        pairCode: action.pairCode,
        pairDeeplink: action.pairDeeplink,
        pairExpiresAt: action.pairExpiresAt,
      };
    case 'paired':
      return {
        kind: 'awaiting_commitment',
        session: action.session,
        enrollCode: action.enrollCode,
        enrollDeeplink: action.enrollDeeplink,
        enrollExpiresAt: action.enrollExpiresAt,
      };
    case 'committed':
      return {
        kind: 'awaiting_verification',
        session: action.session,
        verifyCode: action.verifyCode,
        verifyDeeplink: action.verifyDeeplink,
        verifyExpiresAt: action.verifyExpiresAt,
        challengeNonce: action.challengeNonce,
      };
    case 'completed':
      return { kind: 'completed', session: action.session, tenantUserId: action.tenantUserId };
    case 'failed':
      return { kind: 'error', message: action.message };
    case 'reset':
      return { kind: 'idle' };
  }
}

// ─── Top-level page ──────────────────────────────────────────────

export default function QrRegistration() {
  const { environment } = useEnvironment();
  const [phase, dispatch] = useReducer(reducer, { kind: 'idle' } as Phase);
  // Operator-side inputs for the "open session" form
  const [name, setName] = useState('Alice Doe');
  const [email, setEmail] = useState('alice@example.com');

  const start = useCallback(async () => {
    dispatch({ type: 'create_start' });
    try {
      const res = await api.startRegistration({
        environment,
        profile: { name, email },
      });
      dispatch({
        type: 'create_ok',
        session: res.session,
        pairCode: res.pair.code,
        pairDeeplink: res.pair.deeplink,
        pairExpiresAt: res.pair.expires_at,
      });
    } catch (err) {
      dispatch({ type: 'failed', message: err instanceof ApiError ? err.message : 'Could not start session.' });
    }
  }, [environment, name, email]);

  // ─── Live polling ───────────────────────────────────────────────
  //
  // A real phone scanning QR1 hits POST /v1/registrations/pair-device
  // directly — the dashboard never sees the device-side request, so we
  // poll the session row to learn when the phone has advanced. The
  // simulator path (right column) bypasses this and dispatches the
  // next state directly. Polling cadence: 2 s in awaiting_* states,
  // off everywhere else.
  //
  // The poll only advances state when the server reports a *forward*
  // transition (awaiting_commitment / awaiting_verification /
  // completed). If the server says we're still in the same state, the
  // effect is a no-op — no UI churn, no re-render storm. We do not
  // poll when the state is already terminal (completed / error) or
  // when we're not in a session at all (idle / creating).
  const sessionId = phase.kind !== 'idle' && phase.kind !== 'creating' && phase.kind !== 'error'
    ? ('session' in phase ? phase.session.id : null)
    : null;
  useEffect(() => {
    if (!sessionId) return;
    const isWaitingForPhone = phase.kind === 'awaiting_device'
      || phase.kind === 'awaiting_commitment'
      || phase.kind === 'awaiting_verification';
    if (!isWaitingForPhone) return;
    let cancelled = false;
    const id = window.setInterval(async () => {
      try {
        const { session } = await api.pollRegistration(sessionId, { environment });
        if (cancelled) return;
        // Forward-only transitions: only dispatch if the server has
        // moved past where we currently are.
        if (phase.kind === 'awaiting_device' && session.state === 'awaiting_commitment') {
          // The phone paired but the dashboard didn't see the
          // server-issued enroll_code (it only goes back to the phone).
          // We don't have enrollCode/deeplink/expiresAt on the
          // dashboard side — surface a notice so the operator knows
          // the phone is in the middle of step 2.
          pushToast('info', 'Phone paired ✓ — waiting for biometric commitment.');
        } else if (phase.kind === 'awaiting_commitment' && session.state === 'awaiting_verification') {
          pushToast('info', 'Commitment received ✓ — waiting for verification proof.');
        } else if (session.state === 'completed') {
          dispatch({
            type: 'completed',
            session: session as RegistrationSession,
            tenantUserId: session.tenant_user_id ?? '',
          });
        } else if (session.state === 'abandoned') {
          dispatch({ type: 'failed', message: 'Session was abandoned (expired or cancelled).' });
        }
      } catch {
        // Poll-side errors are silent — the user will see the next
        // action's error if there's a real network issue, and a
        // transient 5xx on poll shouldn't break the flow.
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [sessionId, phase.kind, environment]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">End-user signup ceremony</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-secondary)]">
          Three QR codes on this page, one for each step. The user&apos;s phone scans them in order: register the device,
          submit the biometric commitment, then verify with a fresh proof. The biometric never leaves the phone — only
          the Poseidon commitment (step 2) and the Groth16 proof (step 3) touch the server. See{' '}
          <a
            href="https://github.com/zeroauth-dev/ZeroAuth/blob/main/adr/0023-three-qr-signup-ceremony.md"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            ADR 0023
          </a>{' '}
          for the design.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr,420px]">
        {/* Left column: the platform side — what the operator sees */}
        <div className="space-y-6">
          {phase.kind === 'idle' ? (
            <StartForm
              name={name}
              email={email}
              onNameChange={setName}
              onEmailChange={setEmail}
              onStart={start}
            />
          ) : null}

          {phase.kind === 'creating' ? (
            <Card>
              <CardBody><Skeleton className="h-64" /></CardBody>
            </Card>
          ) : null}

          {phase.kind === 'awaiting_device' ? (
            <QrStep
              step={1}
              title="Pair your phone"
              instruction="Open the ZeroAuth companion app and scan this code to register your phone as a new device."
              code={phase.pairCode}
              deeplink={phase.pairDeeplink}
              expiresAt={phase.pairExpiresAt}
            />
          ) : null}

          {phase.kind === 'awaiting_commitment' ? (
            <QrStep
              step={2}
              title="Submit your biometric commitment"
              instruction="On your phone, capture your face. The app will compute a commitment locally — scan this code to send it to the server. Your face data never leaves the phone."
              code={phase.enrollCode}
              deeplink={phase.enrollDeeplink}
              expiresAt={phase.enrollExpiresAt}
            />
          ) : null}

          {phase.kind === 'awaiting_verification' ? (
            <QrStep
              step={3}
              title="Verify and create account"
              instruction="One last scan. Your phone will re-capture your face and produce a zero-knowledge proof of possession bound to a server-issued challenge. Account is created when the proof verifies."
              code={phase.verifyCode}
              deeplink={phase.verifyDeeplink}
              expiresAt={phase.verifyExpiresAt}
            />
          ) : null}

          {phase.kind === 'completed' ? <CompletedCard tenantUserId={phase.tenantUserId} sessionId={phase.session.id} onReset={() => dispatch({ type: 'reset' })} /> : null}

          {phase.kind === 'error' ? (
            <Card>
              <CardBody>
                <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
                  {phase.message}
                </div>
                <Button className="mt-3" variant="secondary" onClick={() => dispatch({ type: 'reset' })}>Start over</Button>
              </CardBody>
            </Card>
          ) : null}
        </div>

        {/* Right column: the phone simulator */}
        <PhoneSimulator phase={phase} dispatch={dispatch} />
      </div>
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────

function StartForm({
  name,
  email,
  onNameChange,
  onEmailChange,
  onStart,
}: {
  name: string;
  email: string;
  onNameChange: (v: string) => void;
  onEmailChange: (v: string) => void;
  onStart: () => void;
}) {
  return (
    <Card>
      <CardHeader title="Start a registration" description="Tenant SDK calls POST /v1/registrations on the org's signup page." />
      <CardBody className="space-y-3">
        <div>
          <Label htmlFor="reg-name">Name</Label>
          <Input id="reg-name" value={name} onChange={(e) => onNameChange(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="reg-email">Email</Label>
          <Input id="reg-email" type="email" value={email} onChange={(e) => onEmailChange(e.target.value)} />
        </div>
        <Button onClick={onStart}>Open session &amp; mint QR1</Button>
        <p className="text-xs text-[var(--color-text-dim)]">
          The server creates a <code className="font-mono">registration_sessions</code> row in <code className="font-mono">awaiting_device</code> state and returns a one-time pair_code. The plaintext code is returned exactly once; the row stores only its SHA-256.
        </p>
      </CardBody>
    </Card>
  );
}

function QrStep({
  step,
  title,
  instruction,
  code,
  deeplink,
  expiresAt,
}: {
  step: 1 | 2 | 3;
  title: string;
  instruction: string;
  code: string;
  deeplink: string;
  expiresAt: string;
}) {
  const secondsLeft = useCountdown(expiresAt);
  const expired = secondsLeft <= 0;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-3">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-brand)] text-xs font-bold text-white">{step}</span>
            <span>{title}</span>
          </span>
        }
        description={instruction}
      />
      <CardBody>
        <div className="flex flex-col items-start gap-6 sm:flex-row">
          <div className="flex flex-col items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-white p-3">
            <QRCodeSVG
              value={deeplink}
              size={224}
              level="M"
              marginSize={2}
            />
            <Badge tone={expired ? 'danger' : 'success'} className="text-[10px]">
              {expired ? 'Expired' : `Expires in ${formatRemaining(secondsLeft)}`}
            </Badge>
          </div>
          <div className="flex-1 space-y-3 text-sm">
            <div>
              <div className="text-[var(--color-text-dim)] text-xs">Code (typeable)</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="font-mono text-lg font-semibold tracking-widest text-[var(--color-text)] select-all">{code}</code>
                <CopyButton value={code} label="Copy" />
              </div>
            </div>
            <div>
              <div className="text-[var(--color-text-dim)] text-xs">Deep link encoded into the QR</div>
              <div className="mt-1 flex items-center gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-secondary)]">
                <span className="truncate">{deeplink}</span>
                <CopyButton value={deeplink} label="Copy" />
              </div>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function CompletedCard({ tenantUserId, sessionId, onReset }: { tenantUserId: string; sessionId: string; onReset: () => void }) {
  return (
    <Card>
      <CardHeader title="Account created ✓" description="The Groth16 proof verified against the stored commitment; tenant_user row is live." />
      <CardBody className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[var(--color-text-dim)] text-xs">tenant_user_id</div>
            <div className="font-mono text-[11px]">{tenantUserId}</div>
          </div>
          <div>
            <div className="text-[var(--color-text-dim)] text-xs">session_id</div>
            <div className="font-mono text-[11px]">{sessionId}</div>
          </div>
        </div>
        <Button variant="secondary" onClick={onReset}>Run again</Button>
      </CardBody>
    </Card>
  );
}

// ─── Phone simulator ──────────────────────────────────────────────

function PhoneSimulator({ phase, dispatch }: { phase: Phase; dispatch: React.Dispatch<Action> }) {
  const [pairCode, setPairCode] = useState('');
  const [busy, setBusy] = useState(false);

  // Auto-fill the code field as each step's QR becomes visible.
  useEffect(() => {
    if (phase.kind === 'awaiting_device') setPairCode(phase.pairCode);
    else if (phase.kind === 'awaiting_commitment') setPairCode(phase.enrollCode);
    else if (phase.kind === 'awaiting_verification') setPairCode(phase.verifyCode);
    else setPairCode('');
  }, [phase]);

  const scanPair = useCallback(async () => {
    if (phase.kind !== 'awaiting_device') return;
    setBusy(true);
    try {
      const res = await api.__phonePair({
        pair_code: pairCode,
        // 16+ char fingerprint — production phones supply
        // android_id + Play Integrity package + nonce; in the
        // demo we synthesise a stable per-session value so a
        // second run from the same browser window gets a
        // *different* fingerprint and lands as a distinct device row.
        fingerprint: `demo:${phase.session.id}:android_id_xxxxxxxxxxxx`,
        attestation_kind: 'none',
      });
      dispatch({
        type: 'paired',
        session: { ...phase.session, state: 'awaiting_commitment', device_id: res.device_id },
        enrollCode: res.next.code,
        enrollDeeplink: res.next.deeplink,
        enrollExpiresAt: res.next.expires_at,
      });
      pushToast('success', 'Phone paired — device row created.');
    } catch (err) {
      pushToast('danger', err instanceof ApiError ? err.message : 'Pair failed.');
    } finally {
      setBusy(false);
    }
  }, [phase, pairCode, dispatch]);

  const scanCommit = useCallback(async () => {
    if (phase.kind !== 'awaiting_commitment') return;
    setBusy(true);
    try {
      // Demo did + commitment values. In production the phone derives
      // these from the on-device biometric pipeline (mobile/biometric/):
      //   FaceEmbedder → Quantizer → SHA-256 → Poseidon → DID
      // The shapes here match the regex the server validates against.
      const did = `did:zeroauth:face:${phase.session.id.replace(/-/g, '').slice(0, 12)}`;
      const commitment = `0x${'a'.repeat(64)}`;
      const res = await api.__phoneSubmitCommitment({
        enroll_code: pairCode,
        did,
        commitment,
        attestation_kind: 'none',
      });
      dispatch({
        type: 'committed',
        session: { ...phase.session, state: 'awaiting_verification', did, commitment },
        verifyCode: res.next.code,
        verifyDeeplink: res.next.deeplink,
        verifyExpiresAt: res.next.expires_at,
        challengeNonce: res.next.challenge_nonce,
      });
      pushToast('success', 'Commitment submitted.');
    } catch (err) {
      pushToast('danger', err instanceof ApiError ? err.message : 'Submit failed.');
    } finally {
      setBusy(false);
    }
  }, [phase, pairCode, dispatch]);

  const scanVerify = useCallback(async () => {
    if (phase.kind !== 'awaiting_verification') return;
    setBusy(true);
    try {
      // Demo proof. The server's verifyProofOffChain will reject this
      // shape because it's not a real Groth16 proof — that's the
      // expected behaviour and a useful sanity check that the
      // route's plumbing reaches the verifier. To run an actual
      // green path against a real proof the operator should drive
      // /v1/registrations/complete from the android/ tree where the
      // mobile prover lives. The demo's "passes the verifier"
      // sub-flow is on the Phase 1 Sprint 4 roadmap.
      const res = await api.__phoneComplete({
        verify_code: pairCode,
        challenge_nonce: phase.challengeNonce,
        proof: { pi_a: ['1', '2', '3'], pi_b: [['4', '5'], ['6', '7'], ['8', '9']], pi_c: ['10', '11', '12'] },
        public_signals: [phase.session.commitment ?? ''],
      });
      dispatch({
        type: 'completed',
        session: { ...phase.session, state: 'completed' },
        tenantUserId: String(res.tenant_user?.id ?? ''),
      });
      pushToast('success', 'Account created.');
    } catch (err) {
      pushToast('danger', err instanceof ApiError ? err.message : 'Verify failed (expected with demo proof — wire up the mobile prover for the real path).');
    } finally {
      setBusy(false);
    }
  }, [phase, pairCode, dispatch]);

  const action = phase.kind === 'awaiting_device' ? scanPair
    : phase.kind === 'awaiting_commitment' ? scanCommit
    : phase.kind === 'awaiting_verification' ? scanVerify
    : null;
  const buttonLabel = phase.kind === 'awaiting_device' ? 'Simulate phone scan: pair'
    : phase.kind === 'awaiting_commitment' ? 'Simulate phone scan: submit commitment'
    : phase.kind === 'awaiting_verification' ? 'Simulate phone scan: verify'
    : 'Awaiting QR…';

  return (
    <div className="sticky top-4 self-start">
      <Card>
        <CardHeader
          title="Simulate phone"
          description="Drives the phone-side endpoints directly. In production the phone scans the QRs with its camera."
        />
        <CardBody className="space-y-3">
          <PhoneStateLine kind="pair" current={phase.kind} done={['awaiting_commitment', 'awaiting_verification', 'completed'].includes(phase.kind)}>
            Step 1 — Pair device
          </PhoneStateLine>
          <PhoneStateLine kind="enroll" current={phase.kind} done={['awaiting_verification', 'completed'].includes(phase.kind)}>
            Step 2 — Submit commitment
          </PhoneStateLine>
          <PhoneStateLine kind="verify" current={phase.kind} done={phase.kind === 'completed'}>
            Step 3 — Verify and complete
          </PhoneStateLine>
          <div className="pt-2">
            <Label htmlFor="phone-code">Code from the QR</Label>
            <Input
              id="phone-code"
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value)}
              placeholder="ZA-XXXX-XXXX"
              className="font-mono"
            />
          </div>
          <Button onClick={() => action?.()} disabled={!action || busy} loading={busy}>
            {buttonLabel}
          </Button>
          <p className="text-[10px] text-[var(--color-text-dim)]">
            Step 3 will surface a <code className="font-mono">verify_failed</code> because the demo posts a stub proof — that&apos;s the verifier doing its job. Wire up the mobile prover from <code className="font-mono">android/</code> for the real green path.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function PhoneStateLine({
  current,
  done,
  children,
  kind,
}: {
  current: Phase['kind'];
  done: boolean;
  children: ReactNode;
  kind: 'pair' | 'enroll' | 'verify';
}) {
  const active = (kind === 'pair' && current === 'awaiting_device')
    || (kind === 'enroll' && current === 'awaiting_commitment')
    || (kind === 'verify' && current === 'awaiting_verification');
  return (
    <div className={cn('flex items-center gap-2 text-xs', done ? 'text-[var(--color-success)]' : active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-dim)]')}>
      <span className={cn('inline-block h-2 w-2 rounded-full', done ? 'bg-[var(--color-success)]' : active ? 'bg-[var(--color-brand)] animate-pulse' : 'bg-[var(--color-border-subtle)]')} />
      {children}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function useCountdown(expiresAt: string): number {
  const ref = useRef<number>(0);
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const ms = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.floor(ms / 1000));
  });
  useEffect(() => {
    setSecondsLeft(() => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      return Math.max(0, Math.floor(ms / 1000));
    });
    const id = window.setInterval(() => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      const next = Math.max(0, Math.floor(ms / 1000));
      setSecondsLeft(next);
      if (next <= 0) window.clearInterval(id);
    }, 1000);
    ref.current = id;
    return () => window.clearInterval(id);
  }, [expiresAt]);
  return secondsLeft;
}

function formatRemaining(sec: number): string {
  if (sec <= 0) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
