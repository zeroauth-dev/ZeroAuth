#!/usr/bin/env bash
# check-dep-trail — audit npm direct dependencies against /adr/ records.
#
# DP6: every direct dependency in package.json (and dashboard/, website/)
# must have a corresponding ADR under /adr/ named ADR-NNNN-adopt-<name>.md
# or be covered by the grandfather ADR (ADR-0000).
#
# Mode is controlled by the first arg or by env DEP_TRAIL_MODE:
#   advisory  — print findings, exit 0 (default; safe for current CI)
#   strict    — print findings, exit non-zero if anything is missing
#
# Once every direct dep has an ADR, flip the default to "strict" and wire
# the script into .github/workflows/ci.yml.

set -euo pipefail

MODE="${1:-${DEP_TRAIL_MODE:-advisory}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADR_DIR="${ROOT}/adr"

if [[ ! -d "$ADR_DIR" ]]; then
  echo "ERROR: $ADR_DIR not found. ADRs must live in adr/."
  exit 1
fi

# Extract direct (non-transitive) deps from each package.json we own.
collect_deps() {
  local pkg="$1"
  node -e "
    const pkg = require('$pkg');
    const all = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
    for (const name of Object.keys(all).sort()) console.log(name);
  "
}

# Has an ADR file (either grandfather, per-dep file, or named in any ADR body)?
has_adr() {
  local dep="$1"
  # Per-dep ADR by filename convention: NNNN-adopt-<dep>.md
  if find "$ADR_DIR" -maxdepth 1 -name "*adopt-${dep//\//-}*.md" 2>/dev/null | grep -q .; then
    return 0
  fi
  # Bundled ADR that lists the dep in its body as a backtick'd table cell or
  # bullet (e.g. `- \`<dep>\`` or `| \`<dep>\` |`). Covers ADR-0000 (grandfather)
  # AND ADR-0002 (dashboard stack adoption) without growing the file count.
  if grep -Frq -- "\`$dep\`" "$ADR_DIR" 2>/dev/null; then
    return 0
  fi
  return 1
}

missing=()
audited=0
for pkg in "$ROOT/package.json" "$ROOT/dashboard/package.json" "$ROOT/website/package.json"; do
  [[ -f "$pkg" ]] || continue
  workspace="$(basename "$(dirname "$pkg")")"
  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    audited=$((audited + 1))
    if ! has_adr "$dep"; then
      missing+=("$workspace/$dep")
    fi
  done < <(collect_deps "$pkg")
done

echo "Dep-trail audit (DP6): $audited direct dependencies checked across root, dashboard, website."

if [[ ${#missing[@]} -eq 0 ]]; then
  echo "All direct dependencies have an ADR. ✓"
  exit 0
fi

echo ""
echo "Direct dependencies without an ADR (${#missing[@]}):"
for entry in "${missing[@]}"; do
  echo "  - $entry"
done
echo ""
echo "Each missing entry must either be:"
echo "  - added to adr/0000-grandfather-initial-deps.md, OR"
echo "  - covered by its own adr/<NNNN>-adopt-<name>.md (use the dep-add skill)."

if [[ "$MODE" == "strict" ]]; then
  exit 1
fi

echo ""
echo "Mode=advisory; not failing. Re-run with 'strict' once the backlog is cleared."
exit 0
