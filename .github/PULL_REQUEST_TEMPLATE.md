## What does this PR do?

<!-- One short paragraph. Link the issue this closes if any: "Closes #123" -->

## Why is the change needed?

<!-- Motivation, not implementation details. -->

## How was it tested?

- [ ] `npm test` (45/45 passing)
- [ ] `npx tsc --noEmit` clean
- [ ] Manually exercised the affected endpoint(s) with `curl`
- [ ] Added or updated tests

## Privacy & security checklist

- [ ] No code path stores raw biometric templates, proof inputs, or API keys.
- [ ] No new inline event handlers, `eval`, or `Function()` (production CSP
      is `script-src-attr 'none'`).
- [ ] If a new endpoint, it is tenant-scoped and rate-limited.

## Anything the reviewer should know?

<!-- Migrations, deploy ordering, follow-up issues. -->
