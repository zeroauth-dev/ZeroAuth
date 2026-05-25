# ADR-0010 — Android WebView snarkjs bundling + supply-chain guard

## Status

Proposed (gates W3 Android app merge)

## Context

The W3 Android app generates Groth16 proofs on the phone. Production
path is rapidsnark via JNI (~300 ms per proof on a Pixel 7); demo path
is snarkjs.wasm inside a WebView (3–8 s per proof on the same device).
[ADR-0009](0009-qr-proof-pairing-protocol.md) commits to snarkjs for
W3 and defers rapidsnark to a later ADR. This ADR locks down how the
snarkjs runtime ships to user devices, because both reviewers flagged
the same risk:

- **Cryptographer**: "If a malicious WebView injects code into the
  snarkjs runtime on the phone, the attacker can extract the
  biometricSecret straight out of in-process memory. Android Keystore
  does not save you here."
- **Security reviewer** (threat-model row [A-17]): A network/CDN
  attacker swaps a remotely-loaded snarkjs bundle for a malicious
  version that exfiltrates inputs or generates proofs against
  attacker-supplied commitments. Same class as the `event-stream` /
  `ua-parser-js` 2018/2021 supply-chain breaks.

If the WebView ever loads code from the network, the demo's entire
zero-knowledge story collapses to "trust the CDN."

## Decision

### snarkjs ships as a bundled APK asset, never loaded from the network

- `snarkjs.min.js` is committed under `android/app/src/main/assets/
  prover/snarkjs.min.js`, pinned to a SHA-256 captured at the version
  we shipped with. The hash is recorded **in this ADR** AND in the
  build-side manifest at `android/prover-assets.sha256`. The
  `verifyProverAssets` Gradle task fails the build if either side
  drifts.
- The same asset directory carries `identity_proof.wasm` (~1.75 MB —
  circomlib's Poseidon constants ship inside the compiled WASM, hence
  the bigger-than-naïve size) and `circuit_final.zkey` (~507 KB —
  smaller than the original 3.3 MB estimate because the W2 circuit's
  R1CS came in lighter than budgeted; if a future revision blows the
  estimate, revisit the APK-size trade-off here), copied directly from
  `circuits/build/`. Both are hash-pinned.
- The bundle also includes `poseidon.js` (the Poseidon hash kernel
  used by the phone-side Option B′ fold — see ADR-0009), the
  hosting `prover.html`, and the bridge glue at `prover.js`. All
  three are committed as source so the audit trail is
  `git blame`-friendly; all three are hash-pinned.
- `verification_key.json` (~3 KB) ships alongside so the prover can
  self-verify the proof on-device before handing it back to Kotlin.
  Defense-in-depth: a WebView compromise that mints a malformed
  proof gets caught by the in-sandbox verify before the bytes leave.
- The WebView is loaded with `WebViewAssetLoader` against a fixed
  manifest. No `file://` access. No `content://` access. No
  `javascript:` URLs except the single host-to-bridge call
  `javascript:window.zaHandleProve(<json>)`, which is itself a
  same-origin invocation under the locked CSP.

### WebView is process-isolated and CSP-locked

The HTML page loaded into the WebView declares the strictest CSP
that lets snarkjs run:

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

- `connect-src 'none'`: the WebView cannot reach the network, ever.
- `script-src 'self' 'wasm-unsafe-eval'`: only assets bundled in the
  APK; WASM compilation allowed (snarkjs needs it).
- No `'unsafe-eval'`. No external origins.

The hosting `WebView` is configured with:

- `setAllowFileAccess(false)`
- `setAllowContentAccess(false)`
- `setAllowFileAccessFromFileURLs(false)`
- `setAllowUniversalAccessFromFileURLs(false)`
- `setJavaScriptCanOpenWindowsAutomatically(false)`
- `setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW)`
- `setDomStorageEnabled(false)` — no localStorage / IndexedDB inside
  the prover sandbox

The WebView runs in its own renderer process
(`android:process=":prover"` in the manifest) so a renderer
compromise does not give the attacker the rest of the app.

### Build-time integrity gate

`android/app/build.gradle.kts` adds a `verifyProverAssets` task that
hooks into `preBuild` so it runs ahead of EVERY variant assembly
(`assembleDebug`, `bundleRelease`, `installDebug`, the lot). The task
hashes every file under `assets/prover/` and matches it against
`android/prover-assets.sha256`. Three failure modes, all `BUILD FAILED`:

1. A file is present but its digest does not match the pin → drift
   (or someone re-encoded the file with a different line ending,
   etc.); investigate and update the manifest only after re-verifying
   the source.
2. A file is present but isn't pinned → catches "engineer dropped a
   new asset and forgot to update the manifest".
3. A manifest entry has no corresponding file → catches "attacker
   deletes the .zkey to disable verification while keeping the build
   green".

Bumping a prover asset is a 3-file PR:

1. drop the new file into `android/app/src/main/assets/prover/`
2. update the SHA-256 in `android/prover-assets.sha256`
3. update the matching row in the table below

### Pinned asset hashes (current)

Pinned 2026-05-25 against snarkjs 0.7.6 (the upstream `snarkjs.min.js`
emitted by `npm install snarkjs@0.7.6`) and the W2 circuit artifacts
in `circuits/build/` (.wasm / .zkey / verification_key.json emitted
2026-03-11). The build-side manifest at
[`android/prover-assets.sha256`](../android/prover-assets.sha256)
carries the same values; the `verifyProverAssets` Gradle task is the
single source of enforcement.

| Asset | Size | SHA-256 |
|---|---|---|
| `assets/prover/prover.html` | ~1.5 KB | `d5c46ebef7bf378c8d93fce3b0ac339efa6628199a1dedaae4cb1d02040495ce` |
| `assets/prover/prover.js` | ~11 KB | `e1c19e218e275c81b0fe4dc984a8f370dbb89a8828e7fec22f657c7b00cb199a` |
| `assets/prover/poseidon.js` | ~15 KB | `3570b5c7ccb595140e3ff8b4d95f9a01b18f53dbfd9062c83b87a792be476132` |
| `assets/prover/snarkjs.min.js` | ~689 KB | `3f61bbd9ac0a10173902eaef65b510fa4e9a2c057f759c7f18a6d0446b20fd06` |
| `assets/prover/identity_proof.wasm` | ~1.75 MB | `a4b8e00db5d182d7141dd5247ab148c82696326dcabb9f9b4f910543c01fbb20` |
| `assets/prover/circuit_final.zkey` | ~507 KB | `ee3e4c969e186b90d73cb5f11ae70f2b752f02469a897f6bf24a483480a9ddb7` |
| `assets/prover/verification_key.json` | ~3 KB | `81d9632f8e52f92a113467f4253df5a81cfe55805dd19fc154c70359059b4d87` |

### Play Integrity gate (deferred to W4, scaffolding in W3)

The phone calls Play Integrity's `requestIntegrityToken` at proof
generation time and includes the verdict in `clientMeta.playIntegrityVerdict`
in the `/submit` payload. **Server-side enforcement is W4 work**; W3
ships the field plumbing so the verdict is recorded in audit even if
the server doesn't gate on it yet. Tenant policy knob
`tenant.security_policy.require_strong_integrity` lands with the
enforcement.

## Consequences

### Positive

- snarkjs cannot be replaced over the wire. A supply-chain attack now
  requires either a malicious Play Store upload (caught by the signing
  key) or rooting the device (caught by Play Integrity downstream).
- The WebView has no network exit. Even if a runtime bug let an
  attacker inject `<script>`, the CSP blocks `fetch`, `XMLHttpRequest`,
  `WebSocket`, and `Image()` exfil.
- Process isolation contains a renderer compromise to the prover
  sandbox; the app's main process (which holds the user account state
  + Keystore credentials) is unaffected.

### Negative

- APK size grows by ~4 MB (mostly the zkey). Acceptable.
- Bumping snarkjs is a two-file PR with an ADR update. We accept the
  ceremony in exchange for the integrity guarantee.
- The build fails loudly on hash mismatch. Good in CI; mildly
  annoying for the dev who forgets to regenerate after editing
  `assets/prover/`.

### Neutral

- The CSP forbids inline event handlers. The prover HTML page uses
  `addEventListener` only; documented in the build.

## Alternatives considered

- **Load snarkjs from a CDN.** Rejected — exact attack class above.
- **Bundle snarkjs but skip the build-time hash verification.**
  Rejected — half-measure. The hash check is what prevents an
  insider from quietly swapping the asset between commits.
- **Use a native Rust prover (rapidsnark via JNI) instead of WebView.**
  This is the production path. Out of scope for W3 because the JNI
  bridge + cross-compilation setup is a 2-day rabbit hole. Filed as
  the W5+ migration in [ADR-0009](0009-qr-proof-pairing-protocol.md)'s
  non-goals.
- **Run snarkjs in a Node-on-Android embed.** Rejected as a larger
  attack surface than a hardened WebView and no faster.

## References

- [ADR-0009 — QR-proof pairing protocol](0009-qr-proof-pairing-protocol.md)
- Threat model: [A-17 WebView supply-chain](../docs/threat_model.md)
- snarkjs upstream: https://github.com/iden3/snarkjs
- Android `WebViewAssetLoader` docs:
  https://developer.android.com/reference/androidx/webkit/WebViewAssetLoader

---
LAST_UPDATED: 2026-05-25
OWNER: Pulkit Pareek
