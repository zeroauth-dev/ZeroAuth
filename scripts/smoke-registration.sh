#!/usr/bin/env bash
#
# Three-QR signup ceremony smoke test (ADR 0023).
#
# Drives the four documented HTTP round-trips against the deployed
# backend using `curl` + `jq`. Validates that:
#
#   1. POST /v1/registrations issues a pair_code
#   2. POST /v1/registrations/pair-device claims a device row
#   3. POST /v1/registrations/submit-commitment stores (did, commitment)
#      and mints a challenge nonce
#   4. POST /v1/registrations/complete with a STUB proof correctly
#      surfaces 404 verify_failed (the server's verifier rejected it,
#      proving the route plumbing reaches the verifier)
#
# Real-proof verify is a separate manual step that requires the Android
# APK + a real device — see docs/operations/three-qr-signup-deployment.md
# §"Step 5 — End-to-end against a real phone".
#
# Exit codes:
#   0 — all four round-trips landed as expected
#   1 — any round-trip failed or the verify step didn't surface 404
#
# Usage:
#   TENANT_API_KEY=za_live_xxx ./scripts/smoke-registration.sh
#   TENANT_API_KEY=za_live_xxx SERVER=https://staging.zeroauth.dev ./scripts/smoke-registration.sh

set -euo pipefail

: "${TENANT_API_KEY:?set TENANT_API_KEY=za_live_... or za_test_...}"
: "${SERVER:=https://zeroauth.dev}"

# Make sure jq is available — every assertion below needs it.
if ! command -v jq >/dev/null 2>&1; then
  echo "✗ jq is required (brew install jq | apt install jq)" >&2
  exit 1
fi

GREEN=$'\e[32m'
RED=$'\e[31m'
DIM=$'\e[2m'
RESET=$'\e[0m'

fail() {
  echo "${RED}✗ $*${RESET}" >&2
  exit 1
}

step() {
  echo "${DIM}▶${RESET} $*"
}

ok() {
  echo "  ${GREEN}✓${RESET} $*"
}

# ─── Step 0: open session ─────────────────────────────────────────

step "Open registration session against $SERVER"
START_RES=$(curl -fsS -X POST "$SERVER/v1/registrations" \
  -H "Authorization: Bearer $TENANT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"profile":{"name":"Smoke Test","email":"smoke@example.com"}}')

SESSION_ID=$(echo "$START_RES" | jq -r .session.id)
SESSION_STATE=$(echo "$START_RES" | jq -r .session.state)
PAIR_CODE=$(echo "$START_RES" | jq -r .pair.code)
PAIR_DEEPLINK=$(echo "$START_RES" | jq -r .pair.deeplink)

[ "$SESSION_STATE" = "awaiting_device" ] \
  || fail "expected state=awaiting_device, got '$SESSION_STATE'"
[[ "$PAIR_CODE" =~ ^ZA-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$ ]] \
  || fail "pair_code shape invalid: '$PAIR_CODE'"
[[ "$PAIR_DEEPLINK" == zeroauth://reg* ]] \
  || fail "deeplink shape invalid: '$PAIR_DEEPLINK'"
ok "session=$SESSION_ID pair_code=$PAIR_CODE"

# ─── Step 1: pair device ──────────────────────────────────────────

step "Pair device (POST /v1/registrations/pair-device)"
# Fingerprint: 16+ char opaque blob the server SHA-256s. Use a
# timestamp so concurrent smoke runs don't collide.
FINGERPRINT="smoke-$(date +%s)-fp-$(uuidgen 2>/dev/null || echo abcdef0123456789)"
PAIR_RES=$(curl -fsS -X POST "$SERVER/v1/registrations/pair-device" \
  -H "Content-Type: application/json" \
  -d "{\"pair_code\":\"$PAIR_CODE\",\"fingerprint\":\"$FINGERPRINT\",\"attestation_kind\":\"none\"}")

DEVICE_ID=$(echo "$PAIR_RES" | jq -r .device_id)
ENROLL_CODE=$(echo "$PAIR_RES" | jq -r .next.code)
NEXT_STEP=$(echo "$PAIR_RES" | jq -r .next.step)

[ "$NEXT_STEP" = "enroll" ] \
  || fail "expected next.step=enroll, got '$NEXT_STEP'"
[[ "$ENROLL_CODE" =~ ^ZA-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$ ]] \
  || fail "enroll_code shape invalid: '$ENROLL_CODE'"
[ "$DEVICE_ID" != "null" ] && [ -n "$DEVICE_ID" ] \
  || fail "device_id missing from pair-device response"
ok "device_id=$DEVICE_ID enroll_code=$ENROLL_CODE"

# ─── Step 2: submit commitment ────────────────────────────────────

step "Submit commitment (POST /v1/registrations/submit-commitment)"
# Demo did + commitment shapes. The server only validates the regex
# at this layer; the cryptographic check happens on /complete.
COMMITMENT="0x$(printf 'a%.0s' {1..64})"
DID="did:zeroauth:face:smoke$(printf '%.0d' $(seq 1 8))"
COMMIT_RES=$(curl -fsS -X POST "$SERVER/v1/registrations/submit-commitment" \
  -H "Content-Type: application/json" \
  -d "{\"enroll_code\":\"$ENROLL_CODE\",\"did\":\"$DID\",\"commitment\":\"$COMMITMENT\",\"attestation_kind\":\"none\"}")

VERIFY_CODE=$(echo "$COMMIT_RES" | jq -r .next.code)
CHALLENGE=$(echo "$COMMIT_RES" | jq -r .next.challenge_nonce)
NEXT_STEP=$(echo "$COMMIT_RES" | jq -r .next.step)

[ "$NEXT_STEP" = "verify" ] \
  || fail "expected next.step=verify, got '$NEXT_STEP'"
[[ "$VERIFY_CODE" =~ ^ZA-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$ ]] \
  || fail "verify_code shape invalid: '$VERIFY_CODE'"
[[ "$CHALLENGE" =~ ^[0-9a-f]{32}$ ]] \
  || fail "challenge_nonce shape invalid: '$CHALLENGE'"
ok "verify_code=$VERIFY_CODE challenge=$CHALLENGE"

# ─── Step 3: complete with STUB proof — expect 404 verify_failed ──

step "Complete with stub proof (expect 404 verify_failed)"
HTTP=$(curl -sS -o /tmp/smoke-complete.json -w "%{http_code}" -X POST "$SERVER/v1/registrations/complete" \
  -H "Content-Type: application/json" \
  -d "$(cat <<EOF
{
  "verify_code": "$VERIFY_CODE",
  "challenge_nonce": "$CHALLENGE",
  "proof": {
    "pi_a": ["1", "2", "1"],
    "pi_b": [["3", "4"], ["5", "6"], ["1", "0"]],
    "pi_c": ["7", "8", "1"],
    "protocol": "groth16",
    "curve": "bn128"
  },
  "public_signals": ["$COMMITMENT"]
}
EOF
)")

ERR=$(jq -r .error </tmp/smoke-complete.json 2>/dev/null || echo "")

if [ "$HTTP" = "404" ] && [ "$ERR" = "verify_failed" ]; then
  ok "stub proof correctly rejected (HTTP $HTTP error=$ERR)"
else
  fail "expected 404 verify_failed, got HTTP $HTTP error=$ERR — body in /tmp/smoke-complete.json"
fi

# ─── Summary ──────────────────────────────────────────────────────

echo
echo "${GREEN}✓ Smoke OK.${RESET} Four round-trips validated."
echo
echo "Real-proof verify needs the APK + a real device. Steps:"
echo "  1. cd android && ./gradlew :app:installDebug"
echo "  2. Open https://zeroauth.dev/dashboard/demo/registration"
echo "  3. Phone: Create a new account → Scan with camera → each of the three QRs"
echo "  4. Dashboard should land on 'Account created ✓' after QR3"
echo
echo "On failure of QR3 on a real device, capture logcat:"
echo "  adb logcat | grep -E '(ZeroAuth|MobileProver)' > /tmp/prover.log"
echo "  Then see docs/operations/three-qr-signup-deployment.md §'Step 5'."
