# Trusted-setup ceremony runbook — `identity_proof` v1.2

The procedural runbook for the 6-contributor Phase 2 ceremony that
produces the proving / verification keys for `identity_proof` v1.2.
Operational complement to
[ADR 0015 — Circuit version pinning + upgrade procedure](../../adr/0015-circuit-version-pinning.md):
ADR 0015 says *why* a new ceremony is required when the circuit changes;
this document says *how* to run one.

Scope: v1.2 (adds `tx_nonce` and `consent_hash` bindings to public
signals, per `docs/cryptography/identity-proof-v1-2-diff.md`). Same
procedure applies to any future minor or major bump per ADR 0015.

---

## 1. Background

### 1.1 What a trusted setup is

A Groth16 zk-SNARK needs a **structured reference string** (SRS)
generated from secret randomness, in two parts:

- **Phase 1 — Powers of Tau.** Universal, circuit-independent; reusable
  across any Groth16 circuit up to a given size.
- **Phase 2 — Circuit-specific.** Takes Phase 1 output + the compiled
  `*.r1cs` and produces the `*.zkey` (proving key) +
  `verification_key.json`.

The secret randomness is called **toxic waste**. A party holding the
full toxic waste can forge accepted proofs. The ceremony exists to
ensure no single party ever holds it.

### 1.2 Why we need Phase 2

Phase 1 is run **once** per constraint-count family — we rely on the
existing Hermez Powers of Tau (Section 1.5). Phase 2 must be re-run
every time the circuit changes, because the proving key derives from
the specific R1CS of *that* circuit. The v1.1 → v1.2 bump adds two
Poseidon checks (`tx_nonce`, `consent_hash` bindings), so v1.1's
`*.zkey` is unusable for v1.2.

### 1.3 What the ceremony prevents

**Toxic-waste extraction.** A solo-coordinator setup would let that
coordinator forge any "identity verification" proof against any tenant's
commitments — and the on-chain anchor + audit log would record it as
valid. A multi-party chain makes forgery require collusion of **every**
contributor. As long as one contributor honestly destroys their
entropy, the final SRS's toxic waste is unrecoverable.

### 1.4 The assumption we rely on

**One-honest-contributor assumption (1-of-N).** The security argument
needs exactly one honest contributor. Six contributors give a tolerance
of five colluders — the industry standard for ZK ceremonies. We do
**not** rely on identity attestations or clearance checks for
contributors; we rely on procedure: they don't know each other until
the ceremony, and the public transcript proves each contributed.

### 1.5 Which Phase 1 we rely on

Existing `circuits/ptau/` is sized for v1.1 (`pot14_final.ptau`, ≤ 2^14
= 16,384 constraints). v1.2 grows past that, so for v1.2 we adopt
`powersOfTau28_hez_final_15.ptau` from the Hermez ceremony (≤ 2^15 =
32,768 constraints).

Source + SHA-256 (record in
`circuits/ceremony-transcripts/v1.2/00-coordinator-setup.json`):

```
URL:    https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau
SHA256: 9c39bd61135bd0f3f8c0fe4a8e8e96e58e22dfd6dd5d1d0a8e4b6da3c6e0e7ba
```

If `snarkjs r1cs info` shows v1.2 overflows 2^15, bump to `pot28_hez_final_16.ptau` and update the ADR.

---

## 2. Roles

### 2.1 Coordinator (1 person)

Orchestrates the ceremony, publishes the schedule, generates the initial
`circuit_0000.zkey`, receives each contribution + verifies + publishes
its hash, runs the final beacon round, exports the final
`verification_key.json`, owns `circuits/ceremony-transcripts/v1.2/`.

The coordinator does **not** perform any of the 6 randomness
contributions. The role is procedural — except for the beacon round,
which is deterministic from a public input.

**Owner for v1.2:** Agent #11 (Senior Cryptography Engineer, circuit +
prover).

### 2.2 Contributors (6 people)

Each performs **exactly one contribution** sequentially. Contributions
are chained: each takes the prior contributor's output and adds new
randomness.

Selection rules for v1.2:

- At least 2 must be **external** to ZeroAuth (academic ZK researcher,
  partner-bank security engineer, etc.).
- No two contributors share an employer.
- No two contributors use the same laptop model + OS (reduces the blast
  radius of a hypothetical hardware-RNG flaw).
- Contributors are listed in
  `docs/team/crypto/trusted-setup-contributors.md` with names +
  affiliations + slot times.

Each contributor's machine: online only for their slot, snarkjs v0.7+
(`npm i -g snarkjs`), ≥ 4 GB free RAM, verified-clean OS (no second
user, no remote-desktop active).

### 2.3 Independent attestor (1 person)

Ideally an **external cryptographer** (different employer from ZeroAuth
and from all 6 contributors). Re-verifies each contribution's transcript
offline after the ceremony. Publishes a PGP-signed `attestation.pdf`
confirming:

1. Phase 1 ptau hash matches the stated source.
2. Each `snarkjs zkey verify` returns OK.
3. The beacon round matches the public drand record.
4. `verification_key.json` SHA-256 matches the constant pasted into
   `src/services/zkp.ts`.

The attestor catches a compromised coordinator. Without it, a malicious
coordinator could swap an intermediate transcript unnoticed.

**Owner for v1.2:** Agent #27 (cryptanalysis) is the *internal*
attestor; the external attestor is engaged per the SoW Agent #11 + #27
sign in Phase 0 week 4 (`agent-11-crypto-circuit.md` A11-W4-Mon).

---

## 3. Pre-ceremony checklist (T-7 days)

The coordinator drives this. Each row must be completed and signed off in
`circuits/ceremony-transcripts/v1.2/00-coordinator-setup.json` before the
ceremony day.

### 3.1 Phase 1 artefact (T-7)

```bash
curl -L -O https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau
shasum -a 256 powersOfTau28_hez_final_15.ptau
# Expected: 9c39bd61135bd0f3f8c0fe4a8e8e96e58e22dfd6dd5d1d0a8e4b6da3c6e0e7ba
snarkjs powersoftau verify powersOfTau28_hez_final_15.ptau
# Expected: "Powers of Tau Phase 2 ready"
mv powersOfTau28_hez_final_15.ptau circuits/ptau/
```

Record source URL + SHA-256 + verify output in
`00-coordinator-setup.json`.

### 3.2 Circuit compile (T-7)

```bash
# Confirm the source is the frozen v1.2.
shasum -a 256 circuits/identity_proof.circom
# Cross-check against docs/cryptography/identity-proof-v1-2-diff.md.

# Compile to R1CS.
circom circuits/identity_proof.circom \
  --r1cs --wasm --sym -o circuits/build/ -l node_modules

# Confirm constraint count < 2^15 = 32768.
snarkjs r1cs info circuits/build/identity_proof.r1cs

# Generate the starting zkey.
snarkjs groth16 setup \
  circuits/build/identity_proof.r1cs \
  circuits/ptau/powersOfTau28_hez_final_15.ptau \
  circuits/build/circuit_0000.zkey
```

Record SHA-256 of `circuit_0000.zkey` in `00-coordinator-setup.json`.

### 3.3 Schedule + contributor briefing (T-5)

1. Coordinator publishes the slot schedule: one 30-minute slot per
   contributor, 30-minute gap between for coordinator verification +
   transcript publication.
2. Coordinator emails each contributor a briefing pack: this runbook,
   their slot, the SHA-256 of the input zkey they will receive, the
   snarkjs command they will run, entropy-source instructions (3.5).
3. Contributors confirm receipt + slot in writing.

### 3.4 Public ceremony page setup (T-3)

Coordinator creates `circuits/ceremony-transcripts/v1.2/README.md`
listing Phase 1 ptau hash + source, initial `circuit_0000.zkey` SHA-256,
the 6 contributors in order, beacon parameters (drand chain + expected
round number), and the attestor's PGP fingerprint. Merged the morning
of the ceremony.

### 3.5 Entropy generation per contributor (T-1)

Each contributor pre-generates two independent sources, **mixed** at
contribution time:

- **Source A:** OS RNG (`/dev/urandom` on Linux/macOS, `BCryptGenRandom`
  on Windows), captured as a transient string. Do not save to disk.
- **Source B:** Real-world entropy. Acceptable forms:
  - 64 dice rolls, photographed (photo = audit artefact, sequence =
    entropy). Contributor publishes a SHA-256 commitment of the dice
    sequence before contributing, reveals the sequence only after the
    next contributor accepts their output.
  - Hardware RNG dump (OneRNG, Infinite Noise TRNG, etc.) with serial
    number recorded.
  - ≥ 256 coin flips, photographed.

Contributor concatenates the two sources and passes the result as `-e=`
to snarkjs. Neither source is stored on the contribution machine beyond
the slot's duration.

### 3.6 Final dry run (T-1)

Coordinator runs the full procedure on a **disposable** zkey with three
volunteer "rehearsal contributors" — confirms commands work, hash
publication works, page renders, beacon-round computation matches.
Rehearsal output is **destroyed**, not used.

---

## 4. Ceremony day procedure (T+0)

### 4.1 Coordinator opening (09:00 IST)

1. Coordinator publishes the canonical ceremony page (merge to `dev` and
   later `main`).
2. Coordinator announces opening in the team channel + emails the
   contributors.
3. Coordinator confirms the SHA-256 of `circuit_0000.zkey` matches what is
   published; if not — **stop**, the input is compromised.

### 4.2 Per-contributor procedure (09:30 → 12:30 IST)

For each contributor `i ∈ {1..6}`, in the published order:

**a. Verify the prior zkey.** Contributor downloads the prior zkey from
the agreed channel (HTTPS from `zeroauth.dev/ceremony/v1.2/<file>` is
acceptable; round 1 starts from `circuit_0000.zkey`):

```bash
curl -L -O https://zeroauth.dev/ceremony/v1.2/circuit_000<i-1>.zkey
shasum -a 256 circuit_000<i-1>.zkey
# Must match the SHA-256 published on the ceremony page for step <i-1>.
```

SHA-256 mismatch → **stop**, page the coordinator. Do not proceed.

**b. Mix entropy and contribute.**

```bash
snarkjs zkey contribute \
  circuit_000<i-1>.zkey circuit_000<i>.zkey \
  --name="<Contributor name> (<affiliation>)" \
  -v -e="<source-A-bytes>::<source-B-bytes>"
```

The `-v` flag prints a `Contribution Hash:` — record this transcript
hash (it is **not** the zkey SHA-256).

**c. Verify own contribution locally.**

```bash
snarkjs zkey verify \
  circuits/build/identity_proof.r1cs \
  circuits/ptau/powersOfTau28_hez_final_15.ptau \
  circuit_000<i>.zkey
# Expected: "ZKey Ok!"
```

Failure → do **not** publish; page the coordinator.

**d. Publish.** Upload `circuit_000<i>.zkey` to the coordinator via the
agreed channel (typically a one-shot S3 pre-signed URL). Publish:
SHA-256 of the new zkey, transcript hash from step b, entropy
commitments (per Section 3.5), hostname + OS version. Open the
`0<i>-<contributor-name>.json` PR.

**e. Destroy entropy.**

- `shred -u` files holding the mixed entropy string.
- Power-cycle the machine to flush RAM.
- Dice-based source: publish the sequence (consumed; lets the attestor
  verify the commitment).
- HWRNG-based source: `shred -u` the dump.

Coordinator verifies the published SHA-256 matches the received file,
then publishes round `i`'s output (= round `i+1`'s input) on the
ceremony page.

### 4.3 Beacon contribution (12:30 IST)

After all 6 contributors finish, coordinator runs the **final beacon
round** — binds the final zkey to a public, unpredictable value nobody
could have known in advance.

We use the **drand League of Entropy** Quicknet chain:

- **Chain hash:** `8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce`
- **Round:** first drand round with `randomness` published at or after
  `13:00 IST` on ceremony day. Look up:
  ```bash
  curl -s https://api.drand.sh/8990e7a9.../public/latest | jq .
  ```
- **Iterations:** 10 (snarkjs default hash-chain length, 2^10 = 1024).

```bash
snarkjs zkey beacon \
  circuit_0006.zkey circuit_final.zkey \
  <beacon-randomness-hex> 10 \
  --name="ZeroAuth v1.2 ceremony beacon (drand round <N>)" -v
```

Coordinator records round number, `randomness`, and SHA-256 of
`circuit_final.zkey` in `07-beacon.json`.

### 4.4 Export verification key (12:45 IST)

```bash
snarkjs zkey export verificationkey \
  circuit_final.zkey \
  circuits/build/verification_key.json
shasum -a 256 circuits/build/verification_key.json
```

Coordinator records the SHA-256 in `08-final-vkey.json`.

### 4.5 Full-chain verification (13:00 IST)

```bash
snarkjs zkey verify \
  circuits/build/identity_proof.r1cs \
  circuits/ptau/powersOfTau28_hez_final_15.ptau \
  circuits/build/circuit_final.zkey
# Expected: "ZKey Ok!"
```

This walks the whole contribution chain and confirms each contribution
is correctly formed + the beacon was correctly applied. It does **not**
prove any contributor destroyed their entropy — that is unprovable from
the transcript alone.

### 4.6 Ceremony close (13:30 IST)

- Coordinator posts final transcript hashes to the team channel.
- Coordinator pages the external attestor with the transcript URL.
- Coordinator opens the PR updating `src/services/zkp.ts` (new
  `EXPECTED_CIRCUIT_VERSION` + `EXPECTED_VKEY_SHA256` per ADR 0015 §
  2.1) but does **not** merge until attestation lands.

---

## 5. Post-ceremony attestation procedure (T+1 to T+7)

### 5.1 Attestor re-verification (T+1 to T+3)

External attestor re-runs the chain offline on a fresh machine:

```bash
git clone https://github.com/zeroauth/zeroauth.git
cd zeroauth
git checkout <ceremony-commit>

# Phase 1 ptau
shasum -a 256 circuits/ptau/powersOfTau28_hez_final_15.ptau
snarkjs powersoftau verify circuits/ptau/powersOfTau28_hez_final_15.ptau

# Each contribution
for i in 0 1 2 3 4 5 6 final; do
  shasum -a 256 circuits/build/circuit_${i}*.zkey
done

snarkjs zkey verify \
  circuits/build/identity_proof.r1cs \
  circuits/ptau/powersOfTau28_hez_final_15.ptau \
  circuits/build/circuit_final.zkey

# Beacon
curl -s https://api.drand.sh/8990e7a9.../public/<N> | jq .
```

Attestor compares every hash against the published transcripts. Any
mismatch fails the ceremony.

### 5.2 Attestation document (T+4 to T+6)

Attestor writes `attestation.pdf`:

- Identity + affiliation + relationship to ZeroAuth (must be arms-length).
- Each verification command + observed output.
- Beacon-round binding confirmation.
- `verification_key.json` SHA-256 vs. `src/services/zkp.ts` constant.
- Any abnormality observed (or "none observed").

Attestor signs with PGP; `attestation.pdf.asc` lives alongside.

### 5.3 Code constants update (T+5)

Coordinator updates `src/services/zkp.ts`:

```typescript
export const EXPECTED_CIRCUIT_VERSION = 'identity_proof.v1.2';
export const EXPECTED_VKEY_SHA256 =
  '0x<64-hex-chars-from-step-4.4>';
```

Per ADR 0015 § "Landing a new version", the same PR:

- Moves old `circuits/build/*.zkey` + `verification_key.json` to
  `circuits/legacy/v1.1/`.
- Replaces `circuits/build/*` with v1.2 artefacts.
- Adds an entry to `docs/cryptography/version-history.md`.
- Requires APPROVE from both `cryptographer-reviewer` and
  `security-reviewer` sub-agents.

### 5.4 On-chain `Groth16Verifier` redeploy (T+6 to T+7)

Off-chain (`src/services/zkp.ts`) and on-chain verifier must share the
vkey. Base Sepolia first:

```bash
npx hardhat run scripts/deploy-contracts.ts --network base-sepolia
```

Record the new address in `contracts/deployed-addresses.json`. Mainnet
follows the separate runbook at
`docs/operations/groth16-verifier-deploy.md`.

---

## 6. Ceremony transcript repo layout

The full transcript lives under `circuits/ceremony-transcripts/v1.2/` and
is the single source of truth a third party can audit. Layout:

```
circuits/ceremony-transcripts/v1.2/
├── README.md                       # Public summary + index.
├── 00-coordinator-setup.json       # ptau hash + source + circuit_0000.zkey hash.
├── 01-<name>.json … 06-<name>.json # One per contributor (shape below).
├── 07-beacon.json                  # drand chain + round + randomness + final zkey hash.
├── 08-final-vkey.json              # verification_key.json + SHA-256 + zkp.ts constant.
├── attestation.pdf                 # External attestor PGP-signed PDF.
├── attestation.pdf.asc             # PGP signature.
└── attestor-pubkey.asc             # Attestor's PGP public key for offline verify.
```

Shape of each `0<i>-<name>.json`:

```json
{
  "round": 1,
  "contributor": { "name": "Alice Example", "affiliation": "Independent Researcher", "external": true },
  "input_zkey_sha256": "0x<prior-zkey-sha>",
  "output_zkey_sha256": "0x<this-zkey-sha>",
  "snarkjs_transcript_hash": "<hash from snarkjs zkey contribute -v>",
  "snarkjs_version": "0.7.4",
  "entropy_sources": [
    { "kind": "os-rng", "channel": "/dev/urandom", "commitment_sha256": "<hash of source-A>" },
    { "kind": "dice-rolls", "count": 64, "commitment_sha256": "<hash of sequence>", "revealed_after_round": 2 }
  ],
  "machine": { "os": "Ubuntu 24.04", "cpu": "AMD Ryzen 7 7700X", "ram_gb": 32 },
  "started_at": "2026-08-15T09:30:00+05:30",
  "finished_at": "2026-08-15T09:51:42+05:30",
  "verified_by_coordinator_at": "2026-08-15T09:54:11+05:30"
}
```

Every field is mandatory. Missing fields fail the attestor's review.

---

## 7. Failure recovery

The ceremony is restartable from the last good state. A failure does not
mean redoing every round.

### 7.1 Contributor machine compromised mid-contribution

Indicator: unexpected network connection, second user logged in, entropy
file appears on a sync'd drive.

1. Contributor halts snarkjs (`Ctrl-C`); the partial zkey is invalid.
2. Contributor `shred -u`'s artefacts of the attempt.
3. Coordinator removes the in-flight round (never committed to the repo).
4. **Substitute contributor** from the reserve list (coordinator keeps 2
   names) takes the slot, starting from the same input zkey. Chain length
   stays at 6.

A compromised in-flight round does **not** poison earlier rounds — prior
entropy is already destroyed and the chain proves prior outputs are
unchanged.

### 7.2 Contributor goes silent

Indicator: no output zkey 48 h past the scheduled slot, no response on
the agreed channel.

1. Coordinator pages on a secondary channel (phone, alt email).
2. After a further 24 h with no response, coordinator declares the slot
   abandoned and activates the substitute (as in 7.1 step 4).
3. The abandonment is recorded in `attestation.pdf`.

We do **not** skip the round — skipping reduces N toward the
one-honest-contributor floor.

### 7.3 Beacon round changes / drand outage

Indicator: targeted drand round delayed (drand has had outages of up to
6 h) or coordinator misses the round window.

1. Pick the next available round at or after the original target + 1 h.
2. Re-run `snarkjs zkey beacon` with the new round's `randomness`.
3. `07-beacon.json` records both intended and actually-used round numbers
   with a one-paragraph rationale.

Not a security failure — the beacon must only be unpredictable at
ceremony start; a later round is even less predictable.

### 7.4 Coordinator machine compromised

Indicator: unexpected SSH session in logs, AV alert, anything the
coordinator cannot explain.

1. **Stop** all in-flight contributions.
2. Role transfers to the backup coordinator (Agent #13 for v1.2).
3. Backup audits published transcripts against their own copies (the
   chain proves prior outputs unchanged).
4. Ceremony resumes from the last good round under the new coordinator.
5. Event is documented in `attestation.pdf`.

The coordinator holds no toxic-waste material — only inputs, outputs,
and SHA-256s — so a coordinator compromise can stall but cannot poison
the ceremony, provided contributors verify the input zkey before each
round (Section 4.2 step a).

### 7.5 `snarkjs zkey verify` fails on the final zkey

1. Walk the chain backwards, verifying each contribution:
   ```bash
   snarkjs zkey verify <r1cs> <ptau> circuit_000<i>.zkey
   ```
2. The first failing `i` identifies the corrupted contribution.
3. Discard and re-run that contribution with a substitute. **All
   subsequent contributions then re-run in order** — Groth16 trusted
   setup has no splice-in primitive.

A failed final verify after a clean per-step verify indicates snarkjs
corruption; coordinator re-installs and re-runs.

---

## 8. What this runbook does NOT cover

### 8.1 Powers of Tau Phase 1 ceremony

We **rely on** the existing Hermez Phase 1 ceremony for BN128.
Re-running Phase 1 needs dozens of contributors over weeks and is out of
scope. Reference:

- Source URL: <https://github.com/iden3/snarkjs#7-prepare-phase-2>
- File: `powersOfTau28_hez_final_15.ptau` (or 16 if v1.2 overflows 2^15)
- SHA-256: `9c39bd61135bd0f3f8c0fe4a8e8e96e58e22dfd6dd5d1d0a8e4b6da3c6e0e7ba`
- Original transcript: <https://github.com/weijiekoh/perpetualpowersoftau>

A Hermez compromise (e.g. all 176 contributors collude) would force the
whole Groth16 ecosystem to restart — not a ZeroAuth-only concern.

### 8.2 Mainnet `Groth16Verifier` deployment

Covered by `docs/operations/groth16-verifier-deploy.md` (lands phase 1
week 11): Hardhat scripts, verifier-address rotation, coordinated cutover
with `src/services/zkp.ts`, rollback (keep old verifier address for
historic-proof verification per ADR 0015 § "Rollback path"). This runbook
stops at "the SHA-256 is pasted into the code"; the deploy runbook picks
up there.

### 8.3 Internal-incident response

If toxic-waste extraction is suspected **after** a zkey is in production,
the response is a security incident. See `docs/security/incident-response.md`
(when it lands). This runbook governs **prevention**, not response.

### 8.4 Auditor selection

This runbook assumes the external attestor has already been engaged.
Selection criteria, SoW template, and contractual obligations live in
`docs/team/crypto/external-attestor-sow.md` (off-repo; reference logged),
owned by Agents #11 + #27 per A11-W4-Mon.

---

LAST_UPDATED: 2026-05-28
OWNER: Agent #11 (crypto-circuit) + Agent #27 (cryptanalysis)
