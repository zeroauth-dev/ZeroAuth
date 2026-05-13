# B02 — Verifier service split-out · Design doc (plan mode)

> **Author:** Pulkit Pareek
> **Date:** 2026-05-13 (Day 3 of Week 1)
> **Status:** PROPOSED — awaiting Pulkit's pick between Plan A (Rust, separate repo) and Plan B (TypeScript workspace) before any code is written
> **Mandate:** plan mode required per `CLAUDE.md` for any change to `src/services/zkp.ts`
> **Reviewers:** Pulkit (technical), Amit (governance + go-to-market implications)
> **Pairs with:** `B02_verifier_service_bootstrap.md` (the build prompt), `governance: docs/threat-model/verifier.md` (the component threat model stub that gets fleshed out by this work)

---

## 1. Why this exists

Today, ZKP verification lives inline inside the central API repo at [`src/services/zkp.ts`](../../src/services/zkp.ts) — 209 lines of TypeScript that load `snarkjs` dynamically, hold the verification key in module state, and call straight into the Express request handlers. That's correct for the v0 / pre-pilot world (today). It is **not** what we want when:

- A buyer's security team asks for the verifier's blast radius. Today the answer is "as broad as the Node process — the same heap holds the verifier, the audit log writer, the API key cache, and the SAML demo gate." That's not a defensible answer in a regulated industry.
- The trusted setup files (`identity_proof.wasm`, `identity_proof.zkey`, `identity_proof.vkey.json`) need to be cryptographically pinned to a specific service build. Today they're loaded from disk by `initZKP()` with no provenance check.
- The B19 load test (planned Week 6) needs a stable HTTP target with predictable latency. The current inline call goes through Express middleware + tenant auth + audit-log-write before the actual `groth16.verify` — load characteristics are dominated by everything *except* the verifier.
- The `cryptographer-reviewer` subagent's scope (per `CLAUDE.md` standing instruction §5) covers `src/services/zkp.ts`. Every change to the API repo's other files creates ambiguity about whether the cryptographer needs to look at it. Splitting the verifier into its own repo gives the cryptographer a tight, well-defined surface.

B02 in the dev brainstorm puts this work in Week 2 Day 1 — i.e. Monday 2026-05-18. We're starting plan mode three days early (Wednesday Day 3 of Week 1) so Pulkit walks into Monday with a committed plan instead of a blank page.

## 2. Current state — what we're peeling

### 2.1 The file

[`src/services/zkp.ts`](../../src/services/zkp.ts), 209 lines. Public surface:

| Function | Used by | What it does |
|---|---|---|
| `initZKP()` | `src/server.ts:6` startup | Dynamically imports `snarkjs`, loads `verificationKey` from `config.zkp.vkeyPath` |
| `verifyBiometricProof(req)` | `src/routes/zkp.ts`, `src/routes/v1/zkp.ts` | Orchestrator: validates timestamp window (5 min), nonce format (UUIDv4), publicSignals shape (3 elements), then calls `verifyProofOffChain` and optionally `verifyProofOnChain` |
| `verifyProofOffChain(proof, pub)` | internal | Pure `snarkjs.groth16.verify` call |
| `getCircuitInfo()` | `src/routes/zkp.ts`, `src/routes/v1/zkp.ts` | Reads config: wasmPath, vkeyAvailable, verifyOnChain |
| `isZKPReady()` | `src/routes/health.ts:3` | Health check — is `snarkjs` imported |

### 2.2 What's wrong with this surface, today

1. **Module-state singletons** (`snarkjs`, `verificationKey`). Process restart re-loads from disk; no provenance check on the vkey file. If an attacker overwrites the vkey on disk between deploys, the next restart silently accepts the modified key.
2. **The fallback mode is dangerous.** When `verificationKey` is missing, `verifyBiometricProof` falls back to `isValidProofStructure` — a shape check that returns `true` for any well-formed Groth16 envelope. This is intentional for dev-without-compiled-circuit, but on production it would mean "no vkey = all proofs valid". `src/services/zkp.ts:124-128` logs a `warn` but doesn't refuse to serve. Open finding.
3. **Replay window not bound to issued nonces** (per threat-model A-02). Today the nonce is format-checked but not cross-referenced against a `issued_nonces` table — within the 5-min window, the same proof can be replayed. The dev brainstorm's A-02 explicitly calls this a "high residual risk" item.
4. **No verifier-local audit log.** Audit events about verifications are written to the API's Postgres `audit_events` table (good — tenant-scoped, retained 7y), but the *verifier itself* keeps no append-only local log. If the API's Postgres is compromised, an attacker can rewrite the audit history. The cryptographer-reviewer's mitigation in the brainstorm is "verifier has its own append-only SQLite with hash chain, independent of Postgres."
5. **`snarkjs` is a JavaScript implementation of Groth16.** It's correct + widely used, but the surface area of its dep tree (transitive: `ffjavascript`, `web-worker`, `@iden3/...`) is large and Node-only. The cryptographer-reviewer subagent's instructions specifically call out that audit-class verifier code prefers Rust + `arkworks` (~10 transitive deps, all audited).

### 2.3 The five callers

```text
src/server.ts            — calls initZKP() at boot, before app.listen()
src/routes/zkp.ts        — legacy /api/auth/zkp/verify (still served)
src/routes/v1/zkp.ts     — /v1/auth/zkp/verify (the canonical surface)
src/routes/v1/zkp.ts     — /v1/auth/zkp/circuit-info (read-only metadata)
src/routes/health.ts     — GET /api/health includes isZKPReady()
```

The migration must preserve every one of those routes' externally-observable behavior. `tests/zkp.test.ts` is the regression net (run against the existing inline implementation today, must stay green after the split).

## 3. The fork in the road — Plan A vs Plan B

This is the decision Pulkit needs to make before Thursday morning. I lay out both honestly. **I recommend Plan A** for reasons in §3.3, but Plan B is defensible.

### 3.1 Plan A — full B02 (Rust verifier in its own repo)

**Repo:** new `pulkitpareek18/ZeroAuth-Verifier` (public, MIT, Rust).

**What gets built:**

- Rust binary, listens on `:3001` (loopback only — never internet-exposed).
- `POST /verify` — accepts `{ proof, public_signals, tenant_id, environment, circuit_version, correlation_id }`, returns `{ verified: bool, verifier_audit_id: string, latency_ms: number, circuit_version: string }`.
- `GET /health` — version + readiness.
- `GET /metrics` — Prometheus, fields redacted of any tenant-identifying data.
- Cargo workspace, two crates: `verifier-core` (the Groth16 logic) and `verifier-service` (axum HTTP shell).
- SQLite WAL-mode database `audit.db`, append-only via SQL triggers blocking UPDATE + DELETE. Schema: one table `verifier_events` with hash chain (see §4.4).
- Reproducible Docker build via `docker buildx build --provenance=true --sbom=true`. Build twice on clean machines → identical image digest.
- Three founding ADRs in the new repo: 0001 verifier architecture, 0002 Groth16/BN254 (acknowledging that the existing circuit uses BN128 = BN254-modular-equivalent), 0003 SQLite append-only.

**What the API repo keeps:**

- `src/services/zkp.ts` shrinks to ~40 lines — just an HTTP client to the verifier service.
- The five callers remain unchanged.
- A new config `config.zkp.verifierUrl` (defaults `http://localhost:3001`).
- The dev `docker-compose.yml` adds a `verifier` service.

**Crate selection** (per B02 quality bar, minimal + audited):

| Crate | Why | Pinned to | ADR scope |
|---|---|---|---|
| `arkworks-groth16` + `ark-bn254` + `ark-ff` | Groth16 verifier over BN254 | 0.5.x | first use → one bundle ADR is acceptable per B02 §1 |
| `axum` + `tower` + `tower-http` | HTTP server | 0.7.x | bundled |
| `tracing` + `tracing-subscriber` | Structured logs | 0.1.x | bundled |
| `serde` + `serde_json` | (de)serialization | 1.x | bundled |
| `rusqlite` + `r2d2_sqlite` | SQLite with connection pool | 0.30 / 0.22 | bundled |
| `sha2` | Hash chain | 0.10.x | bundled |
| `hex` + `uuid` | small utilities | latest | bundled |
| `proptest` (dev) | property tests for the verifier | 1.x | bundled |

`unsafe` blocks: **zero** allowed without a per-block ADR.

**Effort estimate:** 2.5–3.5 days of focused work for the bootstrap quality bar. Achievable Thu (Day 4) + Fri (Day 5) + Monday morning if it slips.

### 3.2 Plan B — TypeScript split into a sub-workspace (the pragmatic shortcut)

**Repo:** stays in `pulkitpareek18/ZeroAuth`. New directory `verifier/` becomes a separate npm workspace.

**What gets built:**

- `verifier/package.json` — own dependencies (`snarkjs`, `express`, `pg`, etc.) — fully isolated from the API repo's deps.
- `verifier/src/index.ts` — small Express server on `:3001`, single `POST /verify` route.
- Same SQLite audit log + hash chain as Plan A.
- Dockerfile stage `verifier-build` is added; production image grows by ~80 MB.

**Effort estimate:** 1–1.5 days. Achievable Thursday alone.

### 3.3 Which plan and why

**Recommendation: Plan A.**

Three reasons in priority order:

1. **The cryptographer-reviewer subagent's standing instructions** (per `CLAUDE.md` §5) effectively assume Rust + arkworks. The reviewer's competence is calibrated against the arkworks API; reviewing a snarkjs split adds a calibration layer.
2. **The "no outbound network calls" constraint** (B02 §Constraints) is harder to enforce in Node — every transitive npm dep could opt into a fetch call. In Rust, an `axum`-only service with `default-features = false` on everything else has a much smaller "outbound by accident" surface.
3. **The reproducible build constraint** is feasible in both languages but trivial in Rust + buildx + cargo-lock vs gymnastic in Node (npm install non-determinism, transitive native modules).

**Counter-argument for Plan B:** time. If the demo battery is still HOLD by Friday and we have no signed buyer, spending 3 days on a Rust rewrite when a 1-day Node split would buy 80% of the security wins is suboptimal. **Compromise:** ship Plan B first, treat it as the "v0 split" that gets the routing surface right, and migrate to Plan A (Rust) in Week 4 once the IoT firmware is the dominant work. This means writing the design doc twice — once now (Plan B), once in Week 4 (Plan A). Real cost: ~1 extra day of design work + the throwaway Node code.

**My pick:** Plan A. The brainstorm framed this as Week 2 Day 1 specifically because the first SOW conversations are 4 weeks out — there's just barely enough runway to get the verifier into the Rust-on-arkworks shape that pilot buyers will expect. Slipping to Plan B now means slipping again in Week 4, which is when the IoT firmware also lands; double-loading week 4 is the worst time.

But — and this matters — **Pulkit is the only engineer.** If Pulkit's Rust capacity is limited (the brainstorm doesn't claim Pulkit is a Rust expert; it claims Claude Code can scaffold Rust), there's a real risk that the Rust path eats 5 days instead of 3. Pulkit decides.

### 3.4 Decision needed today

I need one of:

- **A.** "Go Plan A (Rust separate repo)." → tomorrow I scaffold the Rust crate.
- **B.** "Go Plan B (TypeScript workspace)." → tomorrow I peel the Node code into `verifier/`.
- **C.** "Hold — start B02 next week as the brainstorm says, do something else Thursday." → I roll Thursday into closing PR #22's three Mediums (issue [#26](https://github.com/pulkitpareek18/ZeroAuth/issues/26)) and the W05 review prep.

If no decision by EOD Wednesday, default = C (defer).

---

## 4. The plan (Plan A)

The rest of this doc assumes Plan A. If we pick B, I produce a separate, shorter doc.

### 4.1 Repo layout

```text
zeroauth-verifier/
├── CLAUDE.md                     ← constitution; references governance: docs/shared/*
├── README.md
├── LICENSE                       ← MIT (matches API repo)
├── Cargo.toml                    ← workspace
├── Cargo.lock                    ← committed
├── verifier-core/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                ← public API: verify_proof(), VerificationKey
│       ├── groth16.rs            ← arkworks wrapping
│       ├── circuit_loader.rs     ← load + checksum the vkey at startup
│       └── errors.rs
├── verifier-service/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs               ← axum boot
│       ├── routes/
│       │   ├── verify.rs         ← POST /verify
│       │   ├── health.rs         ← GET /health
│       │   └── metrics.rs        ← GET /metrics
│       ├── audit/
│       │   ├── schema.rs         ← SQL migrations
│       │   ├── writer.rs         ← append-only writer with hash chain
│       │   └── verify_chain.rs   ← reconstruct + validate chain
│       └── config.rs
├── circuits/                     ← symlink or copy of the trusted setup files
│   ├── identity_proof.vkey.json
│   └── CHECKSUMS.txt             ← SHA-256 of every trusted-setup file
├── tests/
│   ├── verify_integration.rs
│   ├── audit_append_only.rs      ← negative test: UPDATE/DELETE fail
│   ├── hash_chain.rs             ← reproducible reconstruction
│   └── property/                 ← proptest fuzzing of proof structure
├── Dockerfile                    ← multi-stage, --provenance=true
├── docker-compose.yml            ← dev-only, for local API↔verifier
├── adr/
│   ├── 0001-verifier-architecture.md
│   ├── 0002-groth16-bn254-not-plonk.md
│   └── 0003-sqlite-append-only.md
└── .github/workflows/
    ├── ci.yml                    ← cargo test --release + clippy
    └── reproducible-build.yml    ← builds twice, asserts image digest match
```

### 4.2 HTTP shape

`POST /verify` — request body:

```json
{
  "proof": {
    "pi_a": ["...", "...", "1"],
    "pi_b": [["...","..."],["...","..."],["1","0"]],
    "pi_c": ["...", "...", "1"],
    "protocol": "groth16",
    "curve": "bn128"
  },
  "public_signals": ["...", "...", "..."],
  "tenant_id": "uuid",
  "environment": "live|test",
  "circuit_version": "v1",
  "correlation_id": "uuid"
}
```

Response 200:

```json
{
  "verified": true,
  "verifier_audit_id": "uuid",
  "latency_ms": 12,
  "circuit_version": "v1"
}
```

Response 400 on malformed input; 503 on key-not-loaded; 500 only on unexpected internal panic (which should never happen — every panic site is an `expect` with a documented invariant).

**No tenant data in the response.** Just the boolean verdict + an opaque audit reference + latency for observability.

### 4.3 Audit log schema

SQLite, WAL mode for crash safety + concurrent readers:

```sql
CREATE TABLE verifier_events (
  id              TEXT PRIMARY KEY,           -- UUID v4
  tenant_id       TEXT NOT NULL,
  environment     TEXT NOT NULL,              -- 'live' | 'test'
  circuit_version TEXT NOT NULL,
  correlation_id  TEXT NOT NULL,              -- traces back to API's audit_events row
  verified        INTEGER NOT NULL,           -- 0 | 1
  proof_hash      TEXT NOT NULL,              -- SHA-256 of canonical(proof) — full proof never stored
  pub_signals_hash TEXT NOT NULL,             -- SHA-256 of canonical(public_signals)
  latency_us      INTEGER NOT NULL,
  created_at      TEXT NOT NULL,              -- ISO 8601 UTC
  prev_hash       TEXT NOT NULL,              -- chain pointer
  entry_hash      TEXT NOT NULL               -- SHA-256(canonical(this row excluding entry_hash) || prev_hash)
);

CREATE INDEX idx_verifier_tenant_env_created
  ON verifier_events (tenant_id, environment, created_at DESC);

-- Append-only triggers
CREATE TRIGGER verifier_events_no_update
  BEFORE UPDATE ON verifier_events
  BEGIN SELECT RAISE(ABORT, 'verifier_events is append-only'); END;

CREATE TRIGGER verifier_events_no_delete
  BEFORE DELETE ON verifier_events
  BEGIN SELECT RAISE(ABORT, 'verifier_events is append-only'); END;
```

Genesis row inserted at first boot with `prev_hash = '0'.repeat(64)`.

### 4.4 Hash chain construction

Per B02 §5:

```text
entry_hash = sha256(canonical_serialize(entry_without_entry_hash) || prev_hash)
```

Canonical serialization: JSON with sorted keys, no whitespace, UTF-8. Implementation: `serde_json` with the `preserve_order` feature disabled (default → sorts) + bytes pumped to `sha2::Sha256`.

The `verify_chain.rs` test reconstructs the chain from a clean DB checkout and asserts each `entry_hash` matches a re-computation. If any row's `entry_hash` doesn't match its `prev || serialize(row)`, the chain is broken — alert.

### 4.5 Verification key cache strategy

- Loaded at startup from `circuits/identity_proof.vkey.json`.
- File SHA-256 compared against `CHECKSUMS.txt` (which is committed); mismatch → refuse to start.
- Cached as a parsed `ark_groth16::VerifyingKey` in an `Arc<>` for cheap clone-per-request.
- **No reload at runtime.** Updating the vkey requires a service restart. ADR-0001 captures this.

### 4.6 Reproducible build

```dockerfile
# Dockerfile (verifier)
FROM rust:1.85-slim-bookworm@sha256:<pinned> AS builder
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY verifier-core/Cargo.toml verifier-core/
COPY verifier-service/Cargo.toml verifier-service/
RUN cargo fetch --locked
COPY . .
RUN cargo build --release --locked --frozen

FROM gcr.io/distroless/cc-debian12@sha256:<pinned>
COPY --from=builder /src/target/release/verifier-service /verifier
COPY circuits/ /circuits/
EXPOSE 3001
USER 1000:1000
ENTRYPOINT ["/verifier"]
```

Build command in CI: `docker buildx build --provenance=true --sbom=true --output type=oci,dest=verifier.oci . `

Reproducibility check (the `.github/workflows/reproducible-build.yml`): build twice in fresh runners; assert `sha256sum verifier.oci` matches across both runs. If it doesn't, fail the workflow + open an issue.

### 4.7 API repo changes

Inside `pulkitpareek18/ZeroAuth`:

1. **`src/services/zkp.ts` shrinks** to ~40 lines. New surface:

   ```typescript
   export async function verifyBiometricProof(req: ZKPVerificationRequest): Promise<ZKPVerificationResponse> {
     const res = await fetch(`${config.zkp.verifierUrl}/verify`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         proof: req.proof,
         public_signals: req.publicSignals,
         tenant_id: req.tenantId,
         environment: req.environment,
         circuit_version: 'v1',
         correlation_id: req.correlationId ?? uuidv4(),
       }),
       signal: AbortSignal.timeout(2000),
     });
     // ... map to ZKPVerificationResponse
   }
   ```

2. **`config.zkp.verifierUrl`** added; default `http://localhost:3001`. Production sets via env var.
3. **`docker-compose.yml`** adds the verifier service; production stack adds it to `prod` profile.
4. **`isZKPReady()`** becomes a 1-second timeout fetch to `${verifierUrl}/health`. The API's `/api/health` aggregates.
5. **`tests/zkp.test.ts`** stays green — but now requires either (a) the verifier service running, or (b) a mock `fetch` for unit tests. I'll add a `tests/__mocks__/verifier.ts` that mocks `global.fetch` for the verifier URL.

### 4.8 Migration order (Thursday + Friday)

**Thursday Day 4 — scaffold + verifier service**

1. Morning: `gh repo create pulkitpareek18/ZeroAuth-Verifier --public`. Clone locally. Add `CLAUDE.md` (copying conventions from API repo).
2. `cargo init --bin verifier-service && cargo new --lib verifier-core` workspace setup.
3. Implement `verifier-core` with arkworks Groth16. Write unit + property tests **first**.
4. Implement `verifier-service` HTTP shell with axum. Single `/verify` route, no audit log yet.
5. Wire `tests/verify_integration.rs` — starts the server in-process, posts a known-good proof, expects 200.
6. End-of-day target: `cargo test --release` green; `curl -X POST http://localhost:3001/verify` works against a known-good proof.

**Friday Day 5 — audit log + reproducible build + integration**

1. Morning: SQLite migrations + writer + hash chain. Append-only triggers + negative tests.
2. `Dockerfile` + `docker buildx --provenance`. Run twice; verify identical digest.
3. Wire API repo's `src/services/zkp.ts` to point at `${verifierUrl}/verify`. Update `tests/zkp.test.ts` with the fetch mock.
4. Run end-to-end: API receives `POST /v1/auth/zkp/verify`, forwards to verifier, returns the result.
5. Run `cryptographer-reviewer` subagent on the verifier repo's diff.
6. Run `security-reviewer` subagent on the API repo's `src/services/zkp.ts` change.
7. Open PR in API repo: `Replace inline zkp with HTTP client to zeroauth-verifier`.
8. Update governance repo `docs/threat-model/verifier.md` from stub → real component threat model.
9. Update governance repo `release-coordination/matrix.md` with a new compatibility set `pre-release-2`.

### 4.9 Test plan

| Test | Lives in | What it proves |
|---|---|---|
| `verifier-core` unit | `zeroauth-verifier: verifier-core/src/lib.rs` | arkworks Groth16 accepts the known-good fixture |
| Property tests | `zeroauth-verifier: tests/property/` | Random well-formed proofs are rejected; only fixture passes |
| Negative tests | `zeroauth-verifier: tests/verify_integration.rs` | Wrong public signals → 200 with `verified: false` |
| Append-only | `zeroauth-verifier: tests/audit_append_only.rs` | `UPDATE verifier_events …` → SQL trigger aborts; same for DELETE |
| Hash chain | `zeroauth-verifier: tests/hash_chain.rs` | After N writes, `verify_chain.rs` reconstructs every `entry_hash` from `prev_hash || canonical(row)`. Mutating any column breaks the chain. |
| Reproducible build | `.github/workflows/reproducible-build.yml` | Two clean builds produce identical OCI digest |
| API repo regression | `pulkitpareek18/ZeroAuth: tests/zkp.test.ts` | After the split, every existing test stays green |
| End-to-end | `pulkitpareek18/ZeroAuth: dashboard/e2e/happy-path.spec.ts` | Signup → first key → verification call → audit log entry — all still works |

### 4.10 Threat model deltas

After the split, update `pulkitpareek18/ZeroAuth-Governance: docs/threat-model/`:

- **`canonical.md`** — A-02 (replayed proof verification) — mitigation summary updates: "issued-nonce binding lives in the verifier service, not the API"
- **`api.md`** — A-02 section pointer changes from "primary mitigation lives in API" to "delegated to verifier"
- **`verifier.md`** — promoted from stub to first-class:
  - A-V01 — Verifier audit log tamper via direct SQLite write
  - A-V02 — Verification key swap on disk between deploys
  - A-V03 — Side-channel attack via timing on `pi_a` length variations
  - A-V04 — Resource exhaustion via crafted proof inputs (mitigated: every input bounded; arkworks deserializer hardened)
  - A-V05 — Cross-tenant verification via spoofed `tenant_id` in `/verify` request (mitigated: API is the only client; verifier trusts API but logs `tenant_id` for forensic correlation)

### 4.11 Risks + open questions

1. **Rust toolchain on Pulkit's machine** — verified? If not, day 4 morning starts with `rustup install stable` and learning curve cost.
2. **arkworks BN254 vs our existing circuit's BN128.** They're the same curve (BN254 is the modern name for what `snarkjs` calls `bn128`). The vkey format is compatible — `snarkjs` exports include the BN254 G1/G2 points in a JSON shape arkworks can parse with a small adapter. **TODO:** verify before Thursday — if the shapes diverge, the work doubles.
3. **Issued-nonce binding (A-02)** is an open finding. The verifier-side split is a natural place to add the `issued_nonces` SQLite table. Plan A.5 (the bonus): include the issued-nonce binding in the v0 verifier release. Adds ~2 hours.
4. **Performance regression.** The current inline call is a function invocation; the split is a localhost HTTP round-trip. Expected overhead ~1-2ms per call. Acceptable, but should be measured (B19 load test target).
5. **What does production deployment look like?** Today, single `node dist/server.js` on the VPS. Plan A adds a second process (`verifier`) on the same VPS, separate user, separate filesystem, separate systemd unit (or Docker compose service). The Caddyfile doesn't change (verifier never exposed). **Deployment ADR needed.**
6. **Backup of the SQLite audit log.** The Postgres `audit_events` table is the primary audit record; the SQLite is a tamper-evident replica. Backup cadence: nightly snapshot + offsite. The Postgres backup ADR (operational suite open item) covers this — track in the same place.

## 5. Non-goals

Explicitly NOT in this design:

- The B19 load test (separate Week 6 work)
- A multi-region verifier (deferred — single region until the first non-Indian tenant)
- A Plonk verifier (Groth16 is committed; switching curves is a separate ADR)
- An on-chain verifier rotation procedure (handled by `governance: docs/shared/security-policy.md` §3.7)
- A WebAssembly verifier for client-side replay (interesting but out of scope; would require separate threat model)

## 6. Out-of-scope, but worth flagging for Week 3+

- The IoT firmware (B03, Week 3) will need to call the verifier directly (loopback inside the same edge device). The HTTP shape designed here lets that drop in unchanged. Good outcome.
- The mobile SDK (B04, Week 5) does NOT call the verifier — proof generation happens on-device, verification happens server-side. So the SDK only ever calls the API. The HTTP shape designed here doesn't affect the SDK.
- The `B19_k6_verifier_load_test` build prompt will target `POST /verify` directly. We get B19 readiness for free.

---

## 7. Decision matrix — for Pulkit + Amit at the W05 review

| Decision | Options | Recommendation |
|---|---|---|
| Plan A (Rust) vs Plan B (TS workspace) vs hold | A / B / C | **A** |
| Repo structure | One workspace (verifier-core + verifier-service) vs single crate | **Workspace** (per B02 §2) |
| Audit log location | SQLite local to verifier vs Postgres central | **SQLite local** (per B02 §4) — defense in depth |
| Hash chain inclusion | v0 or v1 of verifier | **v0** — non-negotiable per B02 §5 |
| Issued-nonce binding | v0 or v1 | **v0** — closes the A-02 high residual finding |
| Reproducible build | v0 or v1 | **v0** — per B02 quality bar |
| Deployment | Same VPS / Docker compose vs separate VPS | **Same VPS, separate container** (cost) |
| Verifier-API auth | Static shared secret vs mTLS vs none | **Static shared secret** for v0 (loopback only); mTLS in v1 once we have a real PKI |

## 8. What I need from Pulkit before Thursday morning

1. Plan A vs B vs C — pick one.
2. (If A:) Rust toolchain ready on dev machine? `rustc --version` ≥ 1.85.
3. (If A:) Confirmation that the existing `circuits/identity_proof.vkey.json` is BN254-compatible — I'll verify the JSON shape Thursday morning, but if you already know, save me the half-hour.
4. (If A:) Permission to create `pulkitpareek18/ZeroAuth-Verifier` as a public repo.
5. Acknowledgement that this work spans Thu + Fri and may bleed into Monday Week 2. The other Day 4/5 items (closing PR #22's Mediums) get re-prioritized.

If no answer by EOD Wednesday: default = **C (defer to Week 2 Day 1, do PR #22 Mediums Thursday/Friday)**.

---

LAST_UPDATED: 2026-05-13
OWNER: Pulkit Pareek
