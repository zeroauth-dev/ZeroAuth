# QA Log

Twice-weekly engineering QA records, written every Tuesday + Thursday at 9:55am IST per the dev brainstorm's DW01 cadence prompt (`zeroauth_prompt_suite/04_development_suite/03_cowork_dev/DW01_demo_battery.md`). Records are append-only — once a dated file lands here it does not get edited later (corrections go in the next day's file with a back-reference).

## What it is

The four-demo battery is ZeroAuth's smoke test before any buyer-facing demo URL is shared. The four demos:

| # | Demo | Pass criterion |
|---|---|---|
| 1 | **Printed photo rejection** | Hold a printed photo up to the IoT terminal. Reject within 2 seconds. |
| 2 | **Airplane mode authentication** | Set device to airplane mode. Authenticate. UI shows "Authenticated (offline)" + on-device audit ID. |
| 3 | **Three-different-hashes** | Authenticate three times with the same fingerprint. The three on-screen hashes are visibly different. |
| 4 | **Hand-the-phone (impostor)** | Hand the device to a different person who attempts to authenticate as Pulkit. Authentication fails. |

Each demo records: **Green** (pass) / **Yellow** (passes but with caveats) / **Red** (fail) + a one-sentence note.

## Files

- `README.md` — this file
- `STATUS.md` — current rollup: `GREEN` / `YELLOW` / `HOLD`. Updated after every run. `HOLD` means: do not share new buyer-facing demo URLs until the next Green run.
- `LATEST.md` — one-line pointer to the most recent dated entry
- `YYYY-MM-DD.md` — one file per run

## Format of a dated entry

```text
# QA Log — YYYY-MM-DD

**Run by:** <name>
**Build:**
- API: <commit SHA, short>
- IoT firmware: <commit SHA + hardware version, OR "not built">
- Mobile SDK: <commit SHA + bundle hash, OR "not built">

## Results

### Demo 1 — Printed photo rejection
**Status:** Green | Yellow | Red | Blocked
**Note:** <one sentence>

### Demo 2 — Airplane mode authentication
**Status:** ...
**Note:** ...

### Demo 3 — Three-different-hashes
**Status:** ...
**Note:** ...

### Demo 4 — Hand-the-phone
**Status:** ...
**Note:** ...

## Rollup
**Overall:** GREEN | YELLOW | HOLD

## Escalations
<none, or one line per Red demo: "[Demo N] — note — tracking issue #">
```

## Blocked status

Until the IoT firmware (B03), mobile SDK (B04), liveness detection (B13), offline queue (B14), and demo wrappers (B15–B18) ship, the four demos cannot be run. The entry status during this period is `Blocked` per demo, and the rollup is `HOLD`. **The cadence still fires.** A `Blocked` log entry is more honest than no entry — it documents that the discipline is alive and what's gating it.

When B03/B04/B13/B14 ship, the format remains identical; the `Blocked` statuses transition to Green/Yellow/Red on the next run.

## Surrogate smoke during the Blocked period

While the four-demo battery can't run, we substitute with smoke tests against the components that *do* exist today:

- **API smoke** — `curl` the live `/v1/audit`, `/v1/devices`, `/v1/users`, `/v1/verifications` endpoints with a test API key. Expected: all 200.
- **Dashboard smoke** — load `https://zeroauth.dev/dashboard/login`, log in with a known test tenant, navigate every page.
- **E2E happy path** — run `cd dashboard && npm run e2e` (the Playwright spec at `dashboard/e2e/happy-path.spec.ts`).

These appear in dated entries under a "Surrogate smoke (while battery is Blocked)" heading. They are NOT a substitute for the battery — they cover a different surface — but they establish that *something* is being smoked twice a week.

## How to run

Today (during Blocked period):

1. Open the most recent `YYYY-MM-DD.md` file. Copy its template.
2. Rename to today's date. Update the Build block (`git rev-parse --short HEAD` for the API).
3. Run the surrogate smokes. Record results.
4. For each of the four demos, record `Blocked` with the blocking work item.
5. Update `STATUS.md` (will stay `HOLD` during Blocked period).
6. Update `LATEST.md` pointer.
7. Commit: `git add qa-log/ && git commit -m "QA log — YYYY-MM-DD (Blocked + surrogate smoke green)"`.

Once the demos are runnable: follow the same steps but record real Green/Yellow/Red against demos 1–4 instead of `Blocked`.

## Chain hooks

- DW10 (engineering Friday annex) summarises the week's QA log into the W05 packet
- W05 (Friday review packet) reads DW10's annex
- Buyer-facing demo URLs check `STATUS.md` freshness before being shared
