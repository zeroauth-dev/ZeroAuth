# Three-QR signup ceremony — deployment + smoke runbook

End-to-end procedure for getting the ADR 0023 ceremony into a state a friendly pilot tenant can actually use. Walks through every layer (backend → dashboard → Android APK) and provides a smoke-test script the operator runs against the deployed stack to confirm green.

**Scope:** pilot-grade deployment. Not production-grade — see [`docs/security/audit-findings.md`](../security/audit-findings.md) §"Pilot-ready vs production-ready gap" for what's deliberately deferred.

## Prerequisites

- An operator with:
  - `ssh zeroauth-deploy@104.207.143.14` access (production VPS)
  - GitHub admin on `zeroauth-dev/ZeroAuth`
  - Android Studio Iguana+ on a laptop, JDK 17+, ADB, an Android 11+ device
- A tenant API key for the pilot tenant (mint one via the dashboard's **API keys** page → "Generate live key")
- 30 minutes of focused time for the first run; subsequent runs take ~10 min

## Architecture (one paragraph for context)

The signup ceremony is three HTTP round-trips between the phone and the server, plus three render→scan handshakes between the dashboard and the phone. The tenant's signup page (or the dashboard's `/demo/registration`) calls `POST /v1/registrations` to open a session and gets back a one-time `pair_code`. The phone scans QR1 (encoding `zeroauth://reg?step=pair&session=…&code=ZA-XXXX-XXXX`), POSTs to `/v1/registrations/pair-device` with the code + a hardware fingerprint, and the server flips the row to `awaiting_commitment`. The phone captures the biometric locally, computes a Poseidon commitment, scans QR2, and POSTs to `/v1/registrations/submit-commitment` with the (did, commitment) pair — the biometric never leaves the phone. The server then mints `verify_code` + a 128-bit challenge nonce baked into QR3. The phone re-captures the biometric, produces a Groth16 proof using `IsolatedMobileProver` (the snarkjs WebView per ADR 0010), and POSTs to `/v1/registrations/complete`. The server runs `verifyProofOffChain`, asserts `publicSignals[0]` equals the stored commitment, creates a `tenant_user` row, and the ceremony terminates `completed`. Every state transition writes a hash-chained audit row.

## Step 1 — Backend (already deployed)

Already live at `https://zeroauth.dev`. To confirm:

```bash
curl -fsS https://zeroauth.dev/api/health
# expect: { "status": "ok", ... }

curl -fsS -X POST https://zeroauth.dev/v1/registrations \
  -H "Authorization: Bearer za_live_<your_tenant_api_key>" \
  -H "Content-Type: application/json" \
  -d '{"profile":{"name":"Smoke Test","email":"smoke@example.com"}}' \
  | jq .
# expect: { "session": { "id": "...", "state": "awaiting_device", ... },
#           "pair": { "code": "ZA-XXXX-XXXX", "expires_at": "...", "deeplink": "zeroauth://reg?..." } }
```

If the POST returns a 401 the tenant API key is wrong. If it returns a 500 read `/opt/zeroauth/logs/server.log` on the VPS for the actual error.

To deploy a fresh backend build after a commit to `main`:

```bash
# CI handles this automatically; manual fallback:
ssh zeroauth-deploy@104.207.143.14
cd /opt/zeroauth
git pull && docker compose --profile prod up -d --build
docker compose --profile prod logs -f --tail=80 zeroauth-api
# verify the new commit hash in the log header
```

## Step 2 — Dashboard demo (already deployed)

Open <https://zeroauth.dev/dashboard/demo/registration>:

1. Sign in with a console JWT (any registered console account works — the dashboard JWT identifies the tenant; the demo uses the tenant's `live` environment by default).
2. Fill name + email (defaults work for testing).
3. Click **Open session & mint QR1** → three QR codes appear in sequence as the phone hits each endpoint.
4. The right-column **Simulate phone** panel drives the flow from the same browser if you don't have a real phone — useful for sales demos.

## Step 3 — Build and sideload the Android APK

```bash
git clone git@github.com:zeroauth-dev/ZeroAuth.git
cd ZeroAuth/android
gradle wrapper --gradle-version 8.7         # one-time, regenerates the gitignored wrapper jar
./gradlew :app:assembleDebug                # builds app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:installDebug                 # ADB-attached device, or follow `adb pair` then re-run
```

Open the app on the phone → tap **Create a new account (3-QR signup)** on Splash → either tap **Scan with camera** (preferred) or paste the deeplink.

For a release-signed APK ready for Play Internal Test, see [`android/RELEASE.md`](../../android/RELEASE.md). Requires the four keystore secrets in the GitHub Actions secret store; tag-pushes then produce a signed AAB + APK in the workflow's artefacts.

## Step 4 — Smoke test

Drive the script below against the deployed stack to confirm the ceremony works end-to-end without a real phone. The script uses `curl` + `jq` and exits non-zero on any failure.

```bash
# scripts/smoke-registration.sh — runs in <10s against a healthy prod
set -euo pipefail

: "${TENANT_API_KEY:?set TENANT_API_KEY=za_live_...}"
: "${SERVER:=https://zeroauth.dev}"

echo "▶ Open registration session"
START=$(curl -fsS -X POST "$SERVER/v1/registrations" \
  -H "Authorization: Bearer $TENANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"profile":{"name":"Smoke","email":"smoke@example.com"}}')
SESSION_ID=$(echo "$START" | jq -r .session.id)
PAIR_CODE=$(echo "$START" | jq -r .pair.code)
echo "  session=$SESSION_ID pair_code=$PAIR_CODE"

echo "▶ Step 1 — pair device"
PAIR=$(curl -fsS -X POST "$SERVER/v1/registrations/pair-device" \
  -H "Content-Type: application/json" \
  -d "{\"pair_code\":\"$PAIR_CODE\",\"fingerprint\":\"smoke:$(date +%s):0123456789abcdef\"}")
ENROLL_CODE=$(echo "$PAIR" | jq -r .next.code)
echo "  device_id=$(echo "$PAIR" | jq -r .device_id) enroll_code=$ENROLL_CODE"

echo "▶ Step 2 — submit commitment"
COMMIT=$(curl -fsS -X POST "$SERVER/v1/registrations/submit-commitment" \
  -H "Content-Type: application/json" \
  -d "{\"enroll_code\":\"$ENROLL_CODE\",\"did\":\"did:zeroauth:face:abcdef1234567890\",\"commitment\":\"0x$(printf 'a%.0s' {1..64})\"}")
VERIFY_CODE=$(echo "$COMMIT" | jq -r .next.code)
CHALLENGE=$(echo "$COMMIT" | jq -r .next.challenge_nonce)
echo "  verify_code=$VERIFY_CODE challenge=$CHALLENGE"

echo "▶ Step 3 — complete (stub proof — expected to surface verify_failed)"
VERIFY=$(curl -sS -o /dev/null -w "%{http_code}" -X POST "$SERVER/v1/registrations/complete" \
  -H "Content-Type: application/json" \
  -d "{\"verify_code\":\"$VERIFY_CODE\",\"challenge_nonce\":\"$CHALLENGE\",\"proof\":{\"pi_a\":[\"1\",\"2\",\"1\"],\"pi_b\":[[\"3\",\"4\"],[\"5\",\"6\"],[\"1\",\"0\"]],\"pi_c\":[\"7\",\"8\",\"1\"]},\"public_signals\":[\"0x$(printf 'a%.0s' {1..64})\"]}")
if [ "$VERIFY" = "404" ]; then
  echo "  ✓ stub proof correctly rejected (HTTP 404 verify_failed)"
else
  echo "  ✗ expected 404 verify_failed but got $VERIFY" >&2
  exit 1
fi

echo
echo "✓ Smoke OK. Real-proof verify with a real phone:"
echo "  1. Build + install the APK per android/README.md."
echo "  2. On the dashboard demo, open a fresh session."
echo "  3. On the phone, scan each QR with the camera scanner."
echo "  4. The third scan should land the dashboard in the 'Account created' state."
```

Save as `scripts/smoke-registration.sh`, `chmod +x`, and:

```bash
TENANT_API_KEY=za_live_xxx ./scripts/smoke-registration.sh
```

## Step 5 — End-to-end against a real phone

After the smoke passes:

1. Open `https://zeroauth.dev/dashboard/demo/registration` on a laptop.
2. Click **Open session & mint QR1**.
3. On the phone, open the ZeroAuth app → **Create a new account (3-QR signup)** → **Scan with camera** → point at QR1.
4. The dashboard's live polling will surface "Phone paired ✓ — waiting for biometric commitment". QR2 appears.
5. Phone scans QR2 → dashboard shows "Commitment received ✓ — waiting for verification proof". QR3 appears (carries the challenge nonce).
6. Phone scans QR3 → produces a real Groth16 proof via `IsolatedMobileProver` → POSTs to `/complete`.
7. Dashboard shows "Account created ✓". Open the **Users** page (under the same environment) and confirm the new `tenant_user` row appears.

If step 6 surfaces `verify_failed`:
- Check the device's logcat: `adb logcat | grep -E '(ZeroAuth|MobileProver)'` — the prover writes timing + protocol events with the `MobileProver` tag.
- Confirm the server's vkey matches the circuit the prover loaded: `curl https://zeroauth.dev/v1/auth/zkp/circuit-info` and compare the `expectedVkeySha256` against the assets pinned in `android/prover-assets.sha256`.
- If both match and verify still fails, the witness shape is the issue — V1 uses single-arg `Poseidon(commitment)` for `didHash` (per `RealRegistrationProver.kt`), which the circuit allows but Phase 1 Sprint 4's v1.3 circuit will bind explicitly.

## Step 6 — Audit log inspection

Confirm the ceremony wrote the expected hash-chained audit rows:

```bash
curl -fsS "https://zeroauth.dev/api/admin/audit-integrity?tenantId=<tenant_uuid>&environment=live&limit=10" \
  -H "x-api-key: $ADMIN_API_KEY" | jq .
```

Expect five new actions for each completed ceremony:
1. `registration.started`
2. `registration.device_paired`
3. `registration.commitment_submitted`
4. `device.enrolled`
5. `registration.completed`

The chain integrity field should be `ok: true`. Any `false` means a tamper-detect alarm — page security immediately per [`docs/shared/incident-response.md`](https://github.com/zeroauth-dev/ZeroAuth-Governance/blob/main/docs/shared/incident-response.md).

## What still doesn't work end-to-end

Documented for honesty:

| Item | Status | Tracked |
|---|---|---|
| Real face capture | Not wired into the registration flow yet. The phone uses a per-install deterministic 32-byte secret stored in SharedPreferences so the demo can run on devices without a working face sensor. | Phase 1 Sprint 4. See `mobile/biometric/` for the vendored pipeline. |
| Circuit-bound challenge nonce | V1 binds the nonce to the request, not to the circuit's public inputs. Replay is blocked by the single-use verify_code chain + 15-min TTL + rate-limit. | Phase 1 Sprint 4 (circuit v1.3). |
| External cryptographer sign-off | Engagement scoped, not yet started. | Phase 1 week 10. |
| Play Store distribution | Sideload only. Internal Test track ready as soon as the four keystore secrets are loaded into GitHub Actions. | [`android/RELEASE.md`](../../android/RELEASE.md). |
| Branch protection on `main` | Settings flag, no code change required. | Audit finding C-16. |

## Rollback

If a deploy turns red, revert the merge commit on `main` and redeploy:

```bash
ssh zeroauth-deploy@104.207.143.14
cd /opt/zeroauth
git log -5 --oneline                    # find the last known-good commit
git checkout <known_good_sha>
docker compose --profile prod up -d --build
```

Then on a laptop, revert the merge commit on `main`:

```bash
git checkout main
git revert -m 1 <bad_merge_commit>
git push origin main
```

CI will redeploy automatically once the revert lands.
