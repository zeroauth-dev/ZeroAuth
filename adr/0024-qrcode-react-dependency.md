# ADR 0024 — Adopt `qrcode.react` for in-dashboard QR rendering

- **Status:** Accepted
- **Date:** 2026-05-29
- **Phase:** Phase 1 sprint 2 (demo for ADR 0023 three-QR signup ceremony)
- **Related:** ADR 0022 (device enrollment — also wants QRs), ADR 0023 (three-QR signup ceremony)

## Context

ADR 0022 and ADR 0023 both ship deeplinks (`zeroauth://enroll?code=…` and `zeroauth://reg?step=…`) that the operator is supposed to render as scannable QRs on the dashboard, then a phone scans them to advance the flow. Both ADRs explicitly deferred QR rendering "to a follow-up commit with a dep-add ADR" — that's this ADR.

Until now the dashboard rendered the deeplinks as copyable plain-text strings. That works for technical demos and copy-paste integration tests but it's not the user experience either ADR is asking for: a user holding their phone up to the laptop screen and tapping the camera scanner.

The three-QR signup demo (next commit) needs three QRs on one page that update as the state machine advances. Same dep would also be retrofitted into the existing `demo/QrProofLogin.tsx` page (which today fakes the QR with a Unicode block grid).

## Decision

Adopt **`qrcode.react@4.2.0`** as a runtime dependency in `dashboard/package.json`.

### Alternatives considered

| Package | Version | License | Size (unpacked) | Outcome |
|---|---|---|---|---|
| **`qrcode.react`** (chosen) | 4.2.0 | ISC | ~115 kB | React-native component API, SVG output, zero runtime deps, peer on React 19 |
| `qrcode` (node-qrcode) | 1.5.4 | MIT | ~325 kB | Node + browser library, larger, has 7 transitive deps, requires manual Canvas/img wrapping in React |
| `@zxing/library` | 0.21.x | Apache-2.0 | 2.4 MB | Full barcode encode + decode + camera-pipeline library. 100× larger than the actual need; useful when we add scan-from-webcam to the dashboard, deferred |
| Vendored 3kB encoder (e.g. nayuki QR encoder + custom React wrapper) | — | MIT-compatible | ~3 kB | Smallest but reinvents the wheel; the ADR maintenance cost over time exceeds the bundle-size saving |
| External QR-rendering URL (`api.qrserver.com/v1/...`) | — | — | 0 kB | External network dependency on every page render — violates self-host posture; not considered seriously |

### Why `qrcode.react`

- **React-native API.** `<QRCodeSVG value={url} size={224} />` drops in alongside the existing `<CopyButton />`, `<Modal />`, `<Badge />` primitives.
- **SVG output.** Sharper at any zoom level than the Canvas raster path in the `qrcode` library; smaller DOM footprint than a `<canvas>`.
- **Maintainer trust.** Paul O'Shannessy (`zpao` on GitHub) was on the React core team at Facebook from 2013-2018 and has maintained this package continuously since 2014. The package's lifecycle traces directly to a well-known React-ecosystem maintainer.
- **Zero runtime deps.** No transitive dependency surface. The only dep is the peer-dep on React itself which we ship anyway.
- **License compatibility.** ISC is permissive and substantively identical to MIT (same permission grant, no additional obligations). No legal review needed.

### Consequences

**Positive:**
- The three-QR signup demo (ADR 0023) becomes runnable end-to-end without operator-side software changes.
- The existing `demo/QrProofLogin.tsx` block-grid placeholder can be upgraded to a real QR.
- BFSI demo Scene 4 ("operator paints QR on screen, customer scans with phone") becomes a real flow rather than a screen-share charade.

**Negative:**
- +115 kB to the dashboard build's transitive size (gzip footprint estimated at ~10 kB based on the SVG-output path; the unpacked figure includes test fixtures).
- One more package to watch for CVEs in the nightly CVE-monitor workflow.
- Adds a peer-dep validation surface — if we bump React majors we have to verify `qrcode.react` supports the new major.

**Neutral:**
- The deeplink format itself doesn't change. The QR encoding is purely a presentation-layer concern; the URL inside the QR is exactly the same string we were showing in the copyable text field.

## Migration

None — additive only. The existing copy-the-text-link UX continues to work (we render both the QR and the copyable text for accessibility + fallback if the camera scan path fails).

## Supply-chain check

`npm audit` after install:

```
found 0 vulnerabilities
```

No CVEs against `qrcode.react@4.2.0` in the GitHub Advisory Database, OSV, or `npm audit` registry.

## References

- Package: [npmjs.com/package/qrcode.react](https://www.npmjs.com/package/qrcode.react)
- Source: [github.com/zpao/qrcode.react](https://github.com/zpao/qrcode.react)
- License: [ISC](https://opensource.org/licenses/ISC) (substantively equivalent to MIT)
- Threat model: no new threat surface — the dep is pure CPU work on string input; no network, no filesystem, no native code.
