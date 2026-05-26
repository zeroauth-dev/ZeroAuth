/**
 * Play Integrity verdict gate for /v1/proof-pairing/sessions/:id/submit.
 *
 * Pure-function policy evaluator: takes the verdict the Android client
 * forwarded in `clientMeta.playIntegrityVerdict` plus the tenant's
 * `security_policy` JSONB, returns a tagged decision. The route layer
 * surfaces 400 / 401 based on the failure code.
 *
 * Defaults are permissive — a tenant with `security_policy = {}` accepts
 * every submit, including ones without a verdict. BFSI pilots flip
 * `require_strong_integrity: true` + `allow_play_integrity_absent: false`.
 *
 * Tracked by threat-model row A-18 in `docs/threat_model.md`.
 */

import { verdictRank, type TenantSecurityPolicy } from '../types';

export type EvaluateVerdictResult =
  | { ok: true }
  | { ok: false; code: 'play_integrity_required' | 'play_integrity_insufficient'; message: string };

/**
 * Required rank for the supplied policy. Highest wins:
 *
 *   require_strong_integrity → 4
 *   require_device_integrity → 3
 *   require_basic_integrity  → 2
 *   (none of the above)      → 0  (no requirement)
 */
export function requiredRank(policy: TenantSecurityPolicy | null | undefined): number {
  if (!policy) return 0;
  if (policy.require_strong_integrity) return 4;
  if (policy.require_device_integrity) return 3;
  if (policy.require_basic_integrity) return 2;
  return 0;
}

/**
 * Decide whether the presented verdict satisfies the tenant's policy.
 *
 *   - No policy requirement   → ok (any verdict, including absent)
 *   - Verdict absent + policy → ok if `allow_play_integrity_absent`
 *                              else 400 `play_integrity_required`
 *   - Verdict rank < required → 401 `play_integrity_insufficient`
 *   - Verdict rank >= required → ok
 *
 * The 400 vs 401 split is deliberate: "required" is a contract
 * mismatch (client forgot the field), "insufficient" is an
 * authorization failure (device doesn't meet the bar). Dashboards
 * filter on these differently.
 */
export function evaluateVerdict(
  presented: string | undefined | null,
  policy: TenantSecurityPolicy | null | undefined,
): EvaluateVerdictResult {
  const required = requiredRank(policy);
  if (required === 0) {
    return { ok: true };
  }

  const trimmed = typeof presented === 'string' ? presented.trim() : '';
  if (trimmed.length === 0) {
    if (policy?.allow_play_integrity_absent) {
      return { ok: true };
    }
    return {
      ok: false,
      code: 'play_integrity_required',
      message: 'Tenant policy requires a Play Integrity verdict on the submit body.',
    };
  }

  if (verdictRank(trimmed) < required) {
    return {
      ok: false,
      code: 'play_integrity_insufficient',
      message: `Presented Play Integrity verdict is weaker than the tenant's required rank (${required}).`,
    };
  }
  return { ok: true };
}
