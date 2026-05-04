# Privacy and Security

ZeroAuth is built around a simple boundary: authenticate users without retaining reusable biometric material. Zero biometric data stored. Ever.

## Privacy Model

### What reaches the server

#### Registration

During `POST /v1/auth/zkp/register`, the server receives:

- a base64-encoded biometric template from the client.

It uses that payload to derive:

- a SHA-256 biometric identifier,
- a DID,
- a Poseidon `biometricSecret`,
- a Poseidon `commitment`,
- a Poseidon `didHash`.

The biometric template is processed in memory and immediately discarded. It is never stored in any database, cache, or persistent store.

#### Verification

During `POST /v1/auth/zkp/verify`, the server receives:

- a Groth16 proof,
- three public signals,
- a nonce,
- a timestamp.

It does not receive the raw biometric template during verification.

### What persists

#### In the session layer

The session store keeps only:

- `sessionId`
- `userId`
- `provider`
- `verified`
- `createdAt`
- `expiresAt`

#### On chain

The `DIDRegistry` contract stores:

- `bytes32 biometricIDHash`
- `string did`

The blockchain stores a one-way SHA-256 hash of the biometric template, not the raw template itself.

#### In the tenant database

ZeroAuth stores tenant account data (email, hashed password, plan) and usage logs (endpoint, status code, timestamp). No biometric data is stored in the tenant database.

### What is intentionally not stored

- raw biometric templates
- `biometricSecret`
- `salt`
- proof objects after verification
- personal profile data beyond the active session

## Cryptographic Controls

- **SHA-256** — derives the biometric identity hash from the submitted template (irreversible).
- **Poseidon** — field-friendly hashing for commitment derivation and identity binding.
- **Groth16 on bn128** — zero-knowledge proof verification (the server verifies without seeing private inputs).
- **JWT** — access and refresh tokens signed with HMAC.
- **SHA-256 (API keys)** — API keys are hashed before storage; raw keys are shown once at creation.
- **scrypt** — tenant passwords are hashed with scrypt before storage.

## Platform Security Controls

- **Per-tenant rate limiting** — sliding window rate limiting per 15-minute period, configurable by plan.
- **Monthly quota enforcement** — API calls metered and capped per plan tier.
- **Scoped API keys** — each key can be restricted to specific operations (e.g., `zkp:verify` only).
- **API key isolation** — keys are scoped to a single tenant; one tenant cannot access another's resources.
- **helmet** — HTTP security headers on all responses.
- **CORS** — origin restrictions based on environment.
- **PKCE** — generated automatically for OIDC authorization flows.

## Breach-Proof by Architecture

Even if an attacker gains full access to ZeroAuth's databases, they find:

- **No biometric templates** — never stored.
- **No biometric secrets** — returned to the client once, never persisted.
- **No salt values** — returned to the client once, never persisted.
- **No proof objects** — verified and discarded.
- **API keys are hashed** — the raw key cannot be recovered from the stored SHA-256 hash.
- **Passwords are hashed** — tenant passwords use scrypt with random salts.

The only biometric-related data anywhere in the system is the `SHA-256(biometricTemplate)` hash stored on-chain, which is computationally irreversible.

## See Also

- [Architecture](architecture.md) — system components and data flow
- [Contracts and Circuit](../reference/contracts-and-circuit.md) — what lives on-chain
