# vulnerable-lockfile fixture

Known-vulnerable lockfile used by `scripts/cve-monitor.sh --dry-run` and
the `tests/cve-monitor.test.ts` smoke test.

Pins **`lodash@4.17.20`**, which carries **CVE-2021-23337** (severity
**HIGH**, Command Injection via `lodash.template`). The advisory is
permanent — npm's registry will continue to report it on this version
indefinitely — so the fixture stays useful as a CI canary without
having to rotate the pin every time a fresh CVE lands.

Do not depend on this fixture from real code. The `package.json` here
is intentionally not part of the npm workspaces tree (see the root
`package.json`'s `workspaces` array — only `verifier/` is listed).

Related artefacts:
- `scripts/cve-monitor.sh` — the scanner that consumes the fixture in
  `--dry-run` mode.
- `.github/workflows/cve-monitor.yml` — the nightly workflow that
  invokes the scanner.
- `tests/cve-monitor.test.ts` — the smoke test that asserts the
  scanner exits non-zero against this fixture.
- `docs/plan/bfsi-v1/04-commits.md` C-032.
- `docs/security/audit-findings.md` C-14.
