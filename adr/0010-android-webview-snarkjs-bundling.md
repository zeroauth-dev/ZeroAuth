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
  prover/snarkjs-<version>.min.js`, pinned to a SHA-256 captured at
  the version we shipped with. The hash is recorded **in this ADR**
  (and updated in this ADR on every bump). Build fails if the
  on-disk hash differs from the ADR-pinned value.
- The same asset directory carries `identity_proof.wasm` (~150 KB)
  and `circuit_final.zkey` (~3.3 MB), copied at build time from
  `circuits/build/`. Both are hash-pinned in this ADR.
- The WebView is loaded with `WebViewAssetLoader` against a fixed
  manifest. No `file://` access. No `content://` access. No
  `javascript:` URLs.

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
runs before `assembleDebug` and `assembleRelease`. The task SHA-256s
every file under `assets/prover/` and fails the build if the digest
differs from this ADR's pinned table. Bumping snarkjs is therefore
a two-file PR: drop the new bundle + update this ADR's hash table.

### Pinned asset hashes (current)

> **Initial values TBD.** When the assets land in the W3 implementation
> PR, the implementing engineer fills in the table below and reruns
> the verify task to confirm.

| Asset | Size | SHA-256 |
|---|---|---|
| `assets/prover/snarkjs-0.7.4.min.js` | ~600 KB | TBD on landing |
| `assets/prover/identity_proof.wasm` | ~150 KB | TBD on landing |
| `assets/prover/circuit_final.zkey` | ~3.3 MB | TBD on landing |
| `assets/prover/verification_key.json` | ~3 KB | TBD on landing |

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
LAST_UPDATED: 2026-05-22
OWNER: Pulkit Pareek
