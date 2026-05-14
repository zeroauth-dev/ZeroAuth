// ─── Verifier service request/response types ─────────────────────────
//
// These are the wire types for the loopback HTTP boundary between the
// ZeroAuth API and the verifier. Per the B02 plan-mode design doc:
// the verifier accepts a proof + public signals + correlation_id; it
// returns the verdict plus a verifier-side audit id. Tenant identity
// is included for forensic correlation only — the verifier never
// authenticates the caller (loopback-only is the trust boundary).

export interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: 'groth16';
  curve: 'bn128';
}

export interface VerifyRequest {
  proof: Groth16Proof;
  publicSignals: [string, string, string];
  circuitVersion?: string;
  correlationId?: string;
}

export interface VerifyResponse {
  verified: boolean;
  verifierAuditId: string;
  latencyMs: number;
  circuitVersion: string;
  /** True when no verification key was available at startup and the response
   *  was produced by the structural-shape fallback. v0 behaviour — refuse-
   *  to-start replaces this in a follow-up ADR. */
  structuralFallback: boolean;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  vkeyAvailable: boolean;
  uptimeSeconds: number;
}
