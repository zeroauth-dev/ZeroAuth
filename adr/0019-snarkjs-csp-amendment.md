# ADR-0019 — snarkjs WebView CSP amendment (`connect-src 'self'`, `worker-src 'self' blob:`)

## Status

Accepted — amends [ADR-0010](0010-android-webview-snarkjs-bundling.md)
(does not supersede). The §"WebView is process-isolated and CSP-locked"
section of ADR-0010 is rewritten by the **Decision** block below; every
other clause of ADR-0010 (bundling, hash pinning, `verifyProverAssets`
Gradle task, process isolation in `:prover`, Play Integrity scaffolding)
stays in force unchanged. The threat-model rows
[A-17](../docs/threat_model.md#a-17--webview-supply-chain-attack-on-the-snarkjs-build)
and
[A-24](../docs/threat_model.md#a-24--side-channel-leakage-on-the-phone-during-proof-generation)
that cite ADR-0010 keep citing it; the mitigation those rows describe
is unchanged in substance.

> Note on numbering: this file and `0019-poseidon-implementation-choice.md`
> share an ADR number because two threads landed concurrently. The
> [ADR README](README.md) index will be reconciled in a follow-up housekeeping
> commit (this amendment is scope-locked to the CSP change per the task
> brief). Both ADRs are valid and accepted; cross-references should use
> the full slug, not the bare number.

## Context

ADR-0010 (§"WebView is process-isolated and CSP-locked", lines 67-77 of
the file at the time of writing) committed the prover WebView to a CSP
of:

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'self' 'wasm-unsafe-eval';
  connect-src 'none';
  img-src 'none';
  style-src 'self' 'unsafe-inline';
  base-uri 'none';
  form-action 'none';
">
```

The intent recorded in ADR-0010 was unambiguous:

> `connect-src 'none'`: the WebView cannot reach the network, ever.

That intent is correct and remains the security goal. The implementation
choice — the literal CSP directive `connect-src 'none'` — turned out to
be wrong for the runtime snarkjs needs, and the original ADR was written
before anyone had actually loaded `snarkjs.groth16.fullProve` into the
hardened sandbox end-to-end. The mistake surfaced during the C-2 live
debug session described below.

### Live failure observed in the C-2 debug session (2026-06-01)

The C-2 audit finding (`docs/security/audit-findings.md` row C-2) tracks
the migration from `FakeMobileProver` to a real Groth16 prover. Phase 1
Sprint 3 lands real proof generation in the registration ceremony via
the bundled-snarkjs path of ADR-0010. On 2026-06-01 the three-QR
registration ceremony was driven end-to-end against a local backend
(commit `b18e909` — "C-2: live three-QR ceremony reaches step-3 proof
generation"). The setup:

- Pixel 6 AVD (Android Studio API 34 system image).
- Debug build of the Android app with the `:prover` Service forced to
  `isolatedProcess="false"` (separate AVD-only workaround documented in
  the same commit; production keeps `isolatedProcess="true"`).
- Local backend on `:3030` with the registration ceremony wired.
- Real `RealRegistrationProver` calling `WebViewMobileProver.generate`.

Step 1 (QR1 scan) and Step 2 (commitment derivation, biometric capture,
keystore unwrap) passed cleanly. Step 3 — the actual snarkjs proof
generation inside the WebView — failed inside the `:prover` process with
a stream of `Refused to connect to ...` console errors from Chromium:

```
Refused to connect to 'https://appassets.androidplatform.net/assets/prover/identity_proof.wasm' because it violates the following Content Security Policy directive: "connect-src 'none'".
Refused to connect to 'https://appassets.androidplatform.net/assets/prover/circuit_final.zkey' because it violates the following Content Security Policy directive: "connect-src 'none'".
Uncaught (in promise) TypeError: Failed to fetch
```

Followed shortly by:

```
Refused to create a worker from 'blob:https://appassets.androidplatform.net/...' because it violates the following Content Security Policy directive: "default-src 'none'". Note that 'worker-src' was not explicitly set, so 'default-src' is used as a fallback.
```

Two root causes, both stemming from snarkjs's runtime behaviour:

1. **`snarkjs.groth16.fullProve` internally calls `fetch()`** to stream
   `identity_proof.wasm` and `circuit_final.zkey` into WebAssembly. The
   APK assets are served by `WebViewAssetLoader` under the synthetic
   origin `https://appassets.androidplatform.net/assets/prover/`. From
   the browser's point of view a `fetch()` against that URL is a
   `connect-src` request, even though no packet ever leaves the device.
   With `connect-src 'none'` the request is blocked at the CSP layer
   before WebViewAssetLoader ever sees it.

2. **`snarkjs.groth16.fullProve` spawns a Web Worker from a Blob URL**
   to run witness generation off the main thread. The Blob is built
   in-page from the bundled `snarkjs.min.js` source; no third-party
   code is involved. The Worker construction is a `worker-src` request,
   and with no explicit `worker-src` the CSP falls back to `default-src
   'none'`, which blocks it.

Both failures are deterministic — the prover cannot complete a single
proof under the original ADR-0010 CSP. The C-2 commit shipped the CSP
fix inline (with explanatory comments in `prover.html`) so the live
debug session could proceed; this ADR ratifies that change after the
fact, as the commit message promised ("ADR-0010 amendment to follow").

## Decision

Amend ADR-0010 so the CSP recorded as the locked-down baseline reads:

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'self' 'wasm-unsafe-eval';
  connect-src 'self';
  worker-src 'self' blob:;
  img-src 'none';
  style-src 'self' 'unsafe-inline';
  base-uri 'none';
  form-action 'none';
">
```

Two clauses change relative to the original ADR-0010:

- `connect-src` becomes `'self'` (was `'none'`).
- `worker-src` is added with value `'self' blob:` (was implicit via
  `default-src 'none'`).

Every other directive is unchanged. The change is the **minimal**
relaxation needed to let `snarkjs.groth16.fullProve` complete; nothing
about exfiltration capability changes, for the reasons in the next
section.

### Why `connect-src 'self'` does not weaken the "no network egress" guarantee

The original ADR-0010's stated goal was that the WebView cannot reach
the network. That goal still holds, because `'self'` in this WebView
resolves only against the synthetic origin
`https://appassets.androidplatform.net`, which is **not a real
internet host**.

Three independent layers make that synthetic origin non-routable:

1. **The AndroidX WebKit team reserves `appassets.androidplatform.net`
   as a documented placeholder hostname.** Per
   [`WebViewAssetLoader`](https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader)
   documentation, the default authority is `appassets.androidplatform.net`,
   chosen because the `.net` TLD's `androidplatform` subdomain is
   permanently held by Google and never resolves to an A/AAAA record.
   A DNS lookup for it returns `NXDOMAIN`. The hostname exists
   exclusively as a same-origin label for WebView requests; no packet
   destined for it can leave the device.

2. **`WebViewAssetLoader` short-circuits the network entirely.**
   Requests to `https://appassets.androidplatform.net/assets/*` are
   intercepted in-process by the WebView's `shouldInterceptRequest`
   path handler (see
   `android/app/src/main/java/dev/zeroauth/android/prover/WebViewMobileProver.kt`,
   `defaultAssetLoader()` around line 512). The handler reads bytes
   from the APK's `assets/` directory and returns a
   `WebResourceResponse`. The Chromium network stack never opens a
   socket for these URLs; there is no DNS lookup, no TCP handshake,
   no TLS exchange.

3. **The hash-pinned APK assets are the only thing that synthetic
   origin can serve.** Anything not registered with the
   `AssetsPathHandler` returns HTTP 404 from the in-process handler.
   The pinned manifest at `android/prover-assets.sha256` (enforced by
   the `verifyProverAssets` Gradle task at `preBuild`) covers
   `prover.html`, `prover.js`, `poseidon.js`, `snarkjs.min.js`,
   `identity_proof.wasm`, `circuit_final.zkey`, and
   `verification_key.json`. A renderer compromise inside the WebView
   cannot make the handler serve attacker-supplied bytes; it can only
   re-fetch the same hash-pinned assets it already has open in memory.

Net effect: `connect-src 'self'` here is operationally equivalent to
`connect-src 'none'` against any real public origin. Cross-origin
`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Beacon`,
`Image()` exfil, font fetches — all of them remain blocked because the
WebView's CSP forbids any origin other than `'self'`, and `'self'` is
the synthetic, in-process, non-routable origin documented above.

### Why `worker-src 'self' blob:` is safe

snarkjs ships its Worker code inline. At runtime, snarkjs builds a
`Blob` whose contents are bytes already present in the in-page
JavaScript heap (the relevant portion of `snarkjs.min.js`), generates a
`blob:` URL with `URL.createObjectURL`, and constructs a `new Worker`
from that URL. The Worker's source is the same bundled, hash-pinned
snarkjs code as the page that spawned it; no third-party code crosses
the Worker boundary.

The `blob:` token in `worker-src` does **not** grant the Worker any
extra capability:

- The spawned Worker inherits the spawning page's CSP under the same
  rules every other Worker does. `connect-src`, `script-src`, and the
  rest of the directives apply to the Worker as if it were the page.
- A `blob:` URL is same-origin with the page that created it. There is
  no path by which a malicious actor could substitute the Worker's
  source: the Blob's bytes are in-process JavaScript memory that
  arrived via the hash-pinned `snarkjs.min.js`, and the
  `verifyProverAssets` Gradle task fails the build if `snarkjs.min.js`
  ever drifts from the pinned SHA-256.
- The Worker has no Keystore access, no IPC binder access, no main-app
  state access — it lives in the same `:prover` isolated process the
  rest of the WebView lives in (see ADR-0010's process-isolation
  clause). The blast radius of a Worker compromise equals the blast
  radius of a renderer compromise, which is already analysed in
  ADR-0010 and the threat model.

The narrower alternative `worker-src 'self'` (without `blob:`) does not
work in Chromium when the Worker's URL scheme is `blob:`: the scheme
must be listed explicitly. We tried it during the C-2 debug session;
Chromium prints `Refused to create a worker from 'blob:...' because it
violates the following Content Security Policy directive: "worker-src
'self'".` The `blob:` allowance is unavoidable given snarkjs's
implementation; we accept it because the source-of-bytes argument
above makes it safe.

## Consequences

### Positive

- `snarkjs.groth16.fullProve` runs end-to-end inside the hardened
  WebView. C-2 step 3 (real Groth16 proof generation) goes from
  "explodes inside the WebView" to "generates a real proof and posts
  to the server". This unblocks the rest of the C-2 closure work
  (the next iteration debugs the server-side `verify_failed` to nail
  down whether the witness mismatch is code-not-found,
  challenge-mismatch, commitment-mismatch, or proof-verification-
  failed).
- The recorded CSP in ADR-0010 now matches the CSP in `prover.html`,
  so the ADR audit trail and the running code agree.
- Future engineers who read ADR-0010 and trip on `'none'` vs. `'self'`
  have a single place to learn why the change happened.

### Negative

- The CSP value drift required this amendment ADR. Two files are now
  load-bearing for the prover security model (ADR-0010 + this
  amendment); a fresh reader has to read both to get the full story.
  Acceptable cost.
- The literal `connect-src 'none'` claim in old prose (e.g. comments
  that say "no network exit") is now slightly stronger than the
  literal directive. We address that drift in `prover.html` comments
  and in `prover.js` (already updated in commit `b18e909`).

### Neutral

- The `verifyProverAssets` Gradle task, the hash pins, the process
  isolation in `:prover`, the Keystore separation, and the Play
  Integrity scaffolding all stay exactly as ADR-0010 wrote them. This
  amendment touches only the CSP `<meta>` tag.
- No new dependency is introduced. This is purely a configuration
  amendment to a string already in tree; no `dep-add` skill invocation
  is required.

## Alternatives considered

- **Keep `connect-src 'none'` and rewrite the prover glue to inline the
  wasm/zkey as base64-encoded JavaScript strings.** Rejected: blows up
  the prover bundle size (~2.2 MB extra after base64), requires a
  custom path through snarkjs's wasm-instantiation logic (which expects
  to call `fetch`), and defeats the WebViewAssetLoader streaming path
  that the WebKit team optimised for exactly this case. We would be
  writing the worse version of WebViewAssetLoader just to keep a CSP
  string unchanged. Not worth it.
- **Patch snarkjs to remove the internal `fetch` and Worker spawn.**
  Rejected: violates ADR-0010's commitment to ship upstream
  `snarkjs.min.js` byte-for-byte (the SHA-256 pin only works if we
  ship exactly what `npm install snarkjs@0.7.6` emits). A custom
  snarkjs fork is also a maintenance liability and removes the
  supply-chain transparency we get from "this is the same snarkjs
  every other ZK project on the planet uses".
- **Migrate to rapidsnark JNI now.** rapidsnark doesn't use a WebView
  at all, so the CSP question disappears. Rejected for this iteration:
  rapidsnark migration is tracked separately (ADR-0010's "Alternatives
  considered" already flags it as the W5+ migration), and forcing it
  in to dodge a one-line CSP edit would balloon C-2 scope by several
  days. The hardened WebView path was the agreed approach for C-2;
  this amendment lets it ship.
- **Drop `worker-src` entirely and rely on `default-src`.** Rejected:
  `default-src 'none'` would block the Worker spawn, and changing
  `default-src` to be permissive enough to allow `blob:` workers
  would also permissively unlock several other fetch destinations
  (img, font, media). Explicit `worker-src 'self' blob:` is the
  narrowest possible relaxation.

## References

- [ADR-0010 — Android WebView snarkjs bundling + supply-chain guard](0010-android-webview-snarkjs-bundling.md)
  — the parent ADR this amends.
- [ADR-0009 — QR-proof pairing protocol](0009-qr-proof-pairing-protocol.md)
  — commits to snarkjs for the W3 phone path.
- Commit `b18e909` — "C-2: live three-QR ceremony reaches step-3 proof
  generation" — six paired fixes including the CSP change recorded here.
- `android/app/src/main/assets/prover/prover.html` — the file holding
  the amended CSP, with inline comments that mirror this ADR's reasoning.
- `android/app/src/main/java/dev/zeroauth/android/prover/WebViewMobileProver.kt`
  (around line 480-520) — `defaultAssetLoader()` and the `PROVER_URL`
  constant pinning the synthetic origin.
- `docs/security/audit-findings.md` row C-2 — the audit finding whose
  closure this amendment unblocks.
- Threat model rows
  [A-17](../docs/threat_model.md#a-17--webview-supply-chain-attack-on-the-snarkjs-build)
  and
  [A-24](../docs/threat_model.md#a-24--side-channel-leakage-on-the-phone-during-proof-generation)
  — still cite ADR-0010; no rewrite required.
- `androidx.webkit.WebViewAssetLoader` reference:
  <https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader>
- snarkjs upstream (the `fullProve` path that issues the internal
  `fetch` + Worker spawn):
  <https://github.com/iden3/snarkjs/blob/v0.7.6/src/groth16_fullprove.js>
- W3C CSP Level 3, `worker-src` directive:
  <https://www.w3.org/TR/CSP3/#directive-worker-src>

---

LAST_UPDATED: 2026-06-01
OWNER: Pulkit Pareek
