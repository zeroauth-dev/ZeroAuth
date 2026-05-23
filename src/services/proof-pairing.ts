/**
 * Proof-pairing service stub — Commit 1 of W3 ADR-0009.
 *
 * This file exports the error classes the route layer maps onto HTTP
 * status codes, plus stubbed pure-logic functions that throw "not
 * implemented" until Commit 2 fills them in. Tests against this stub
 * fail by design — the green pass arrives with the implementation
 * commit.
 */

import {
  ApiKeyEnvironment,
  AuthToken,
  ProofPairingSession,
  ProofPairingState,
} from '../types';

// ─── Error taxonomy ────────────────────────────────────────────────────
//
// One class per machine error code in docs/error_codes.md under
// "Proof pairing". The route layer catches these and maps to HTTP
// status + JSON body. Never throw plain Error from the public API —
// the catch-all in the route handler turns those into a 500.

export class PairingSessionNotFound extends Error {
  readonly code = 'pairing_session_not_found';
  constructor(message = 'Session not found') { super(message); }
}

export class PairingSessionExpired extends Error {
  readonly code = 'pairing_session_expired';
  constructor(message = 'Session expired') { super(message); }
}

export class PairingSessionAlreadyBound extends Error {
  readonly code = 'pairing_session_already_bound';
  constructor(message = 'Session already bound') { super(message); }
}

export class PairingSessionLocked extends Error {
  readonly code = 'pairing_session_locked';
  constructor(message = 'Session locked after repeated failures') { super(message); }
}

export class PairingSessionBindMismatch extends Error {
  readonly code = 'pairing_session_bind_mismatch';
  constructor(message = 'Session bind cookie missing or wrong') { super(message); }
}

export class PairingNonceMismatch extends Error {
  readonly code = 'pairing_nonce_mismatch';
  constructor(message = 'Public signals nonce mismatch') { super(message); }
}

export class PairingDidUnknown extends Error {
  readonly code = 'pairing_did_unknown';
  constructor(message = 'DID does not resolve to a stored commitment') { super(message); }
}

export class PairingProofInvalid extends Error {
  readonly code = 'pairing_proof_invalid';
  constructor(message = 'Groth16 proof verification failed') { super(message); }
}

export class PairingTenantMismatch extends Error {
  readonly code = 'pairing_tenant_mismatch';
  constructor(message = 'Tenant mismatch') { super(message); }
}

export class TooManyPendingSessions extends Error {
  readonly code = 'too_many_pending_sessions';
  constructor(message = 'Too many open pairing sessions') { super(message); }
}

export class VerifierUnavailable extends Error {
  readonly code = 'verifier_unavailable';
  constructor(message = 'Verifier loopback unavailable') { super(message); }
}

// ─── Public interface shapes ───────────────────────────────────────────

export interface CreateSessionResult {
  id: string;
  nonce: string;
  sessionBindToken: string;
  expiresAt: string;
  qrPayload: string;
}

export interface SessionPublicView {
  id: string;
  state: ProofPairingState;
  expiresAt: string;
  boundAt?: string;
  userId?: string;
  did?: string;
}

export interface SubmitResult {
  session: SessionPublicView;
  verification: { id: string };
  tokens: AuthToken;
}

export interface StreamEvent {
  event: 'session_created' | 'session_bound' | 'session_expired' | 'session_error';
  data: Record<string, unknown>;
}

export interface ClientMeta {
  appVersion?: string;
  platform?: string;
  model?: string;
  proofMs?: number;
  playIntegrityVerdict?: string;
  [key: string]: unknown;
}

// ─── Stubs (Commit 1 — replaced in Commit 2) ───────────────────────────

const NOT_IMPLEMENTED = 'proof-pairing service not yet implemented (Commit 2)';

export async function createSession(
  _tenantId: string,
  _environment: ApiKeyEnvironment,
  _apiKeyId: string,
  _desktopIp: string | null,
  _desktopUserAgent: string | null,
): Promise<CreateSessionResult> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function submitProof(
  _sessionId: string,
  _tenantId: string,
  _environment: ApiKeyEnvironment,
  _did: string,
  _proof: unknown,
  _publicSignals: string[],
  _clientMeta: ClientMeta,
  _presentedSessionBindToken: string | undefined,
): Promise<SubmitResult> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function getSession(
  _sessionId: string,
  _tenantId: string,
  _environment: ApiKeyEnvironment,
  _presentedSessionBindToken: string | undefined,
): Promise<SessionPublicView> {
  throw new Error(NOT_IMPLEMENTED);
}

export async function* subscribeStream(
  _sessionId: string,
  _tenantId: string,
  _environment: ApiKeyEnvironment,
  _presentedSessionBindToken: string | undefined,
): AsyncIterableIterator<StreamEvent> {
  throw new Error(NOT_IMPLEMENTED);
  // Yield is required for AsyncIterableIterator's type to be inferred,
  // but the throw above prevents reaching it.
  yield { event: 'session_error', data: {} };
}

export async function expireOverdueSessions(): Promise<string[]> {
  throw new Error(NOT_IMPLEMENTED);
}

// Touch unused-import guard — these are re-exported to keep callers
// stable across the two commits.
export type { ProofPairingSession };
