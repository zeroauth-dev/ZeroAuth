# @zeroauth/verifier

The ZeroAuth Groth16 verifier service. Receives a proof + public signals over loopback HTTP, returns the verification verdict + a verifier-side audit id.

This is the **TypeScript implementation** per [ADR-0008](../adr/0008-verifier-split-typescript-not-rust.md) (forthcoming) — chosen over a Rust + arkworks implementation for single-engineer velocity. The HTTP shape is deliberately Rust-compatible so a future swap is structural, not behavioural.

## Why a separate process

1. **Blast radius.** A bug or supply-chain compromise in the verifier shouldn't have access to the API's Postgres / Redis credentials, tenant keys, audit log, or admin endpoints.
2. **Load profile.** B19 load tests this service directly — `POST /verify` is the latency-critical path. Isolating the verifier from the rest of the API lets us reason about its latency in isolation.
3. **Audit story.** Buyers' security teams ask "what's the trust boundary around the cryptographic core?" The answer "this 200-line workspace with 4 deps, loopback-only, isolated process" is much cleaner than "it's a function inside the big Express app."

## What it does NOT do (v0, today)

- No SQLite audit log + hash chain — planned Friday Day 5 of Week 1.
- No reproducible build provenance — only a Plan-A (Rust) concern; not feasible in npm.
- No tenant auth — loopback-only is the trust boundary.
- No outbound network — Express + snarkjs only.

## API surface

### `POST /verify`

```text
Request:
{
  "proof":          Groth16Proof,
  "publicSignals":  [string, string, string],
  "circuitVersion": "v1"          // optional, defaults to v1
  "correlationId":  "uuid"        // optional, traces back to caller's audit row
}

200 OK:
{
  "verified":            true | false,
  "verifierAuditId":     "uuid",
  "latencyMs":           12,
  "circuitVersion":      "v1",
  "structuralFallback":  false   // true only when no vkey was loaded at startup
}

400: { "error": "invalid_request", "message": "…" }
500: { "error": "verifier_error" }
```

### `GET /health`

```text
{
  "status":         "ok" | "degraded",
  "version":        "0.1.0",
  "vkeyAvailable":  true | false,
  "uptimeSeconds":  1234
}
```

`status: degraded` means the verifier is running but couldn't load the verification key at startup (dev environment without a compiled circuit). `POST /verify` still responds but with `structuralFallback: true`.

## Configuration

| Env var | Default | What it controls |
|---|---|---|
| `VERIFIER_PORT` | `3001` | HTTP listen port |
| `VERIFIER_BIND` | `127.0.0.1` | Listen interface — **leave at loopback** |
| `VERIFIER_VKEY_PATH` | `circuits/build/verification_key.json` | Path to the Groth16 verification key |
| `VERIFIER_CIRCUIT_VERSION` | `v1` | Returned in `verifyResponse.circuitVersion` |
| `LOG_LEVEL` | `info` | Winston log level |

## Build / run

```bash
# From the repo root (npm workspaces wires everything up)
npm install
npm run verifier:build
npm run verifier:start

# Or in watch mode for dev
npm run verifier:dev
```

## Trust boundary

**The verifier trusts its caller.** It does no tenant auth, accepts any well-formed request, and returns the verdict. The API repo is the only sanctioned caller; the bind address is `127.0.0.1` so nothing else can reach it.

If you ever consider exposing the verifier on a public interface, you MUST first:

1. Add caller authentication (mTLS or shared secret in a header)
2. Add per-caller rate limiting
3. Update the threat model component-extension at `pulkitpareek18/ZeroAuth-Governance: docs/threat-model/verifier.md`
4. Open an ADR

The default loopback bind is the v0 trust model; do not change it without going through the above.

## Pairs with

- API repo's [`src/services/zkp.ts`](../src/services/zkp.ts) — calls this service via `VERIFIER_URL`
- [ADR-0008] (forthcoming) — captures the TS-vs-Rust decision
- [`docs/design/verifier-service-split.md`](../docs/design/verifier-service-split.md) — the plan-mode design doc
- [Governance: `docs/threat-model/verifier.md`](https://github.com/pulkitpareek18/ZeroAuth-Governance/blob/main/docs/threat-model/verifier.md) — component-level threat model
