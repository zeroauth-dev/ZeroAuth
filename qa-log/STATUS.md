# QA Battery — Current Status

**Status:** **HOLD**

**Last updated:** 2026-05-13 (after the seed entry)
**Last run:** [`2026-05-13.md`](2026-05-13.md)
**Next scheduled run:** Thursday 2026-05-14 at 09:55 IST (per DW01 cadence)

## Why HOLD

All four demos are currently `Blocked` because their underlying components do not exist yet (IoT firmware = B03 Week 3, mobile SDK = B04 Week 5, liveness = B13 Week 3/5, offline queue = B14 Week 4, LSH protocol = B10 Week 3+).

**HOLD means:** do not share new buyer-facing demo URLs until the next `GREEN` run.

This is the expected baseline of the QA log during Weeks 1–5 of the 8-week build sprint. HOLD here is not a regression signal — it's the honest representation of "the demo battery cannot run yet."

## When HOLD lifts

HOLD lifts to `GREEN` when:

1. B03 + B13 ship → Demos 1, 3, 4 become runnable on mock hardware
2. B14 ships → Demo 2 becomes runnable
3. B04 ships → Demo 4 fully runnable on real mobile
4. All four demos pass on a single run

Target: Week 5 EOD per the 8-week build order (`zeroauth_prompt_suite/04_development_suite/00_dev_brainstorm/01_dev_brainstorm.md` part 4).

## Surrogate smoke status (today)

While battery is HOLD, surrogate smokes against the components that *do* exist:

- API smoke against `https://zeroauth.dev/v1/*`: **Green** (today)
- Dashboard reachability `/dashboard/{login,signup,overview}`: **Green** (today)
- Playwright happy-path E2E: **Green** (last CI run on commit `0d1741d`, 2026-05-12)
- Jest + Vitest unit suites: **Green** (last CI run on commit `0d1741d`, 2026-05-12)

Surrogate green does NOT lift the HOLD on demo URLs. It only signals that "engineering is healthy" for the W05 weekly review.
