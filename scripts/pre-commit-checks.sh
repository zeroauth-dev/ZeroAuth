#!/usr/bin/env bash
# scripts/pre-commit-checks.sh
#
# Shared gate runner — invoked by `.husky/pre-commit` for local commits
# and by `.github/workflows/ci.yml`'s `pre-commit-mirror` job for the
# server-side enforcement. Single source of truth.
#
# Per docs/plan/bfsi-v1/06-ways-of-working.md § "Commit-time gates",
# this script blocks a commit if any of the following fail:
#
#   1. tsc --noEmit
#   2. eslint . (errors only; warnings allowed)
#   3. Secret scan in staged content
#   4. Forbidden biometric-payload keys in handlers
#   5. ADR-trail check for new package.json deps
#   6. Commit-msg checks (no Co-Authored-By: Claude, no `feat:` prefix)
#   7. jest --findRelatedTests <staged>
#
# Skip mode: set `ZEROAUTH_PRECOMMIT_SKIP=1` for emergency commits.
# This is auditable (the env var lands in shell history) and the CI
# mirror catches anything the local skip waves through.

set -euo pipefail

# When run from .husky/pre-commit, GIT_PARAMS is empty; staged-file list
# comes from `git diff --cached`. When run from CI, the same logic
# applies against the full diff vs the merge base.
GIT_DIR="$(git rev-parse --show-toplevel)"
cd "$GIT_DIR"

# ─── Skip-mode escape hatch ──────────────────────────────────────────
if [[ "${ZEROAUTH_PRECOMMIT_SKIP:-0}" == "1" ]]; then
  echo "⚠️  Pre-commit checks skipped via ZEROAUTH_PRECOMMIT_SKIP=1." >&2
  echo "    The CI mirror will run the same checks on push." >&2
  exit 0
fi

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACMR)

if [[ -z "$STAGED_FILES" ]]; then
  echo "pre-commit: no staged files; nothing to check."
  exit 0
fi

echo "▶ pre-commit checks running on $(echo "$STAGED_FILES" | wc -l | tr -d ' ') staged file(s)"

# ─── Gate 1: TypeScript typecheck ────────────────────────────────────
echo "▶ [1/7] tsc --noEmit"
npx tsc --noEmit
echo "  ✓ tsc clean"

# ─── Gate 2: ESLint (errors only) ────────────────────────────────────
echo "▶ [2/7] eslint (errors only)"
npx eslint src tests scripts --max-warnings 999999
echo "  ✓ eslint no errors"

# ─── Gate 3: Secret scan in staged content ───────────────────────────
echo "▶ [3/7] secret scan"
SECRET_PATTERNS=(
  'BEGIN PRIVATE KEY'
  'BEGIN RSA PRIVATE KEY'
  'BEGIN EC PRIVATE KEY'
  'JWT_SECRET='
  'SESSION_SECRET='
  'ADMIN_API_KEY='
  'BLOCKCHAIN_PRIVATE_KEY='
  'za_live_[0-9a-f]{48}'
  'za_test_[0-9a-f]{48}'
)

# Concatenate the staged content and grep through. We use `git show :FILE`
# rather than reading the working tree so partially-staged files only
# scan their staged content.
SCAN_OUTPUT=""
for file in $STAGED_FILES; do
  # Skip binary files and large bundles.
  case "$file" in
    *.zkey|*.wasm|*.ptau|*.png|*.jpg|*.gif|*.pdf|*.tflite|*snarkjs.min.js)
      continue ;;
  esac
  if [[ ! -f "$file" ]]; then continue; fi
  CONTENT=$(git show ":$file" 2>/dev/null || true)
  for pattern in "${SECRET_PATTERNS[@]}"; do
    if echo "$CONTENT" | grep -E "$pattern" >/dev/null 2>&1; then
      SCAN_OUTPUT="${SCAN_OUTPUT}${file}: matches secret pattern '${pattern}'\n"
    fi
  done
done

if [[ -n "$SCAN_OUTPUT" ]]; then
  echo "  ✗ secret-pattern matches in staged content:"
  echo -e "$SCAN_OUTPUT"
  echo "  If this is a false positive, audit the line + redact, then re-stage."
  exit 1
fi
echo "  ✓ no secret patterns matched"

# ─── Gate 4: Forbidden biometric-payload keys in handlers ────────────
echo "▶ [4/7] biometric-payload key scan"
BIO_FORBIDDEN=(
  'req\.body\.image\b'
  'req\.body\.template\b'
  'req\.body\.pixel\b'
  'req\.body\.depth\b'
  'req\.body\.frame\b'
  'req\.body\.raw_face\b'
  'req\.body\.raw_finger\b'
  'req\.body\.biometric_data\b'
  'req\.body\.photo\b'
)
BIO_OUTPUT=""
for file in $STAGED_FILES; do
  case "$file" in
    src/routes/v1/zkp.ts|src/routes/zkp.ts)
      # Tracked exception: the deprecated legacy endpoint. See
      # tests/biometric-rejection.test.ts.
      continue ;;
    *.ts) ;;
    *) continue ;;
  esac
  CONTENT=$(git show ":$file" 2>/dev/null || true)
  for pattern in "${BIO_FORBIDDEN[@]}"; do
    if echo "$CONTENT" | grep -E "$pattern" >/dev/null 2>&1; then
      BIO_OUTPUT="${BIO_OUTPUT}${file}: reads biometric-payload key '${pattern}'\n"
    fi
  done
done
if [[ -n "$BIO_OUTPUT" ]]; then
  echo "  ✗ biometric-payload key reads in staged content:"
  echo -e "$BIO_OUTPUT"
  echo "  CLAUDE.md non-goal: 'Never accept raw biometric data over the wire.'"
  exit 1
fi
echo "  ✓ no biometric-payload key reads"

# ─── Gate 5: ADR-trail check for new package.json deps ───────────────
echo "▶ [5/7] dep-ADR trail"
if echo "$STAGED_FILES" | grep -E '^package\.json$' >/dev/null; then
  # Diff the dependencies + devDependencies between staged and HEAD.
  # If a new key appeared, require an ADR commit reference.
  OLD_DEPS=$(git show HEAD:package.json 2>/dev/null | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const p=JSON.parse(s);
      const all={...(p.dependencies||{}),...(p.devDependencies||{})};
      console.log(Object.keys(all).sort().join('\n'));
    });
  " 2>/dev/null || true)
  NEW_DEPS=$(git show :package.json | node -e "
    let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
      const p=JSON.parse(s);
      const all={...(p.dependencies||{}),...(p.devDependencies||{})};
      console.log(Object.keys(all).sort().join('\n'));
    });
  ")
  ADDED=$(comm -13 <(echo "$OLD_DEPS") <(echo "$NEW_DEPS") || true)
  if [[ -n "$ADDED" ]]; then
    # Check if any ADR file is also staged that references the new dep
    # name. Be lenient — we look for the dep name anywhere in the
    # staged ADR file contents (the dep-add skill writes the ADR with
    # the dep name in plain text).
    STAGED_ADRS=$(echo "$STAGED_FILES" | grep -E '^adr/[0-9]{4}-' || true)
    UNJUSTIFIED=""
    while IFS= read -r dep; do
      [[ -z "$dep" ]] && continue
      JUSTIFIED=0
      for adr in $STAGED_ADRS; do
        if grep -F -q "$dep" "$adr" 2>/dev/null; then
          JUSTIFIED=1
          break
        fi
      done
      if [[ "$JUSTIFIED" == "0" ]]; then
        UNJUSTIFIED="${UNJUSTIFIED}  - ${dep}\n"
      fi
    done <<< "$ADDED"
    if [[ -n "$UNJUSTIFIED" ]]; then
      echo "  ✗ new dependencies without a matching ADR in this commit:"
      echo -e "$UNJUSTIFIED"
      echo "  Run the dep-add skill (.claude/skills/dep-add/SKILL.md) to write an ADR first."
      exit 1
    fi
  fi
fi
echo "  ✓ no unjustified new deps"

# ─── Gate 6: Commit-msg check (Co-Authored-By, prefix, length) ────────
# Invoked from .husky/commit-msg with the message file as $1; the
# pre-commit hook itself can only check what's already committed via
# `git log`. We skip the commit-msg check here — it lives in the
# separate commit-msg hook.
echo "▶ [6/7] commit-msg checks live in .husky/commit-msg (skipped here)"

# ─── Gate 7: Tests affected by staged files ───────────────────────────
echo "▶ [7/7] jest --findRelatedTests <staged>"
TS_STAGED=$(echo "$STAGED_FILES" | grep -E '\.(ts|tsx)$' | grep -v '\.d\.ts$' | grep -v 'mobile/' || true)
if [[ -z "$TS_STAGED" ]]; then
  echo "  (no .ts/.tsx files staged; nothing to test)"
else
  npx jest --findRelatedTests $TS_STAGED --passWithNoTests --silent || {
    echo "  ✗ tests affected by staged changes are failing."
    exit 1
  }
fi
echo "  ✓ related tests pass"

echo "▶ all gates passed"
