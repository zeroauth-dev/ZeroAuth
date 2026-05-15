# Contributing to ZeroAuth

Thanks for considering a contribution. ZeroAuth is built in the open and we
welcome bug reports, fixes, integrations, and ideas.

## Ways to contribute

- **Found a bug?** Open an [issue](https://github.com/zeroauth-dev/ZeroAuth/issues/new).
  Include reproduction steps, expected vs. actual behaviour, and your
  environment (`node -v`, OS, Docker version).
- **Have a feature in mind?** Start a
  [discussion](https://github.com/zeroauth-dev/ZeroAuth/discussions) before
  opening a PR — we'd rather agree on direction first.
- **Found a security vulnerability?** **Do not** open a public issue. See
  [SECURITY.md](SECURITY.md).

## Development setup

```bash
git clone https://github.com/zeroauth-dev/ZeroAuth.git
cd ZeroAuth
npm run setup                       # installs all workspaces, builds everything
cp .env.example .env                # local env (uses Base Sepolia testnet by default)
npm test                            # 45 jest tests should pass
npm run dev                         # tsx watch mode on :3000
```

For docker-based development:

```bash
./scripts/deploy.sh dev   # brings up app + Redis + Postgres with hot reload
```

## Pull-request checklist

Before opening a PR:

- [ ] `npm test` passes (45/45 with zero data-storage invariant intact).
- [ ] `npx tsc --noEmit` is clean.
- [ ] You have not introduced any code path that persists raw biometric data
      or proof inputs. The `dataStored: false` invariant in tests must hold.
- [ ] No new inline event handlers / `eval` / `Function()` — the production
      CSP is strict (`script-src-attr 'none'`).
- [ ] If you added an endpoint, it has tests and is listed in
      [docs/reference/api-reference.md](docs/reference/api-reference.md).
- [ ] If you changed an env var, it is documented in
      [.env.example](.env.example) and
      [docs/reference/environment-variables.md](docs/reference/environment-variables.md).
- [ ] Commits are signed-off if you can (`git commit -s`).

## Coding style

- TypeScript with `strict: true`. No `any` without a comment explaining why.
- Prefer `async/await` over `.then` chains.
- Errors flow up to the central
  [error-handler](src/middleware/error-handler.ts); don't `try/catch` to
  swallow.
- Logs go through the winston logger; don't `console.log`.
- Solidity changes need a corresponding Hardhat test + redeploy script update.

## Architecture invariants

These are the hills we will die on:

1. **Zero biometric data persistence.** Templates exist in memory only long
   enough to compute their SHA-256 / Poseidon commitment, then are
   `delete`d. No code path writes them to disk, DB, or logs.
2. **API keys are never logged or returned after creation.** Only the SHA-256
   hash is stored; the raw key is shown once.
3. **Public inputs are bound to nonces.** Replay protection is non-optional;
   verification failures are silent (no oracle leakage).
4. **All requests are tenant-scoped.** No global API state — every read/write
   includes a tenant ID derived from the API key.

Pull requests that weaken any of these will be rejected.

## Releases

Tagged on the `main` branch. We follow [SemVer](https://semver.org/):

- `MAJOR` — breaking API change or removal of an endpoint.
- `MINOR` — new endpoints, scopes, or non-breaking flags.
- `PATCH` — bug fixes, dependency bumps, doc-only changes.

Thank you for making ZeroAuth better.
