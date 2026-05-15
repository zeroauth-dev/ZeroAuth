# ───────────────────────────────────────────────
# ZeroAuth Multi-Stage Dockerfile
# Supports: development, test, production targets
# ───────────────────────────────────────────────

# ── Development Stage ─────────────────────────
FROM node:20-alpine AS development
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY circuits/ ./circuits/
COPY contracts/ ./contracts/
COPY dashboard/ ./dashboard/
COPY website/build/ ./website/build/
EXPOSE 3000 5173
CMD ["npx", "tsx", "watch", "src/server.ts"]

# ── Test Stage ────────────────────────────────
FROM node:20-alpine AS test
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json jest.config.* ./
COPY src/ ./src/
COPY tests/ ./tests/
COPY circuits/build/ ./circuits/build/
CMD ["npm", "test"]

# ── Build Stage — API ─────────────────────────
FROM node:20-alpine AS api-build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Build Stage — Dashboard ───────────────────
FROM node:20-alpine AS dashboard-build
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json* ./
RUN npm ci --ignore-scripts
COPY dashboard/ ./
RUN npm run build

# ── Build Stage — Documentation ───────────────
FROM node:20-alpine AS docs-build
WORKDIR /app/website
COPY website/package.json website/package-lock.json* ./
RUN npm ci --ignore-scripts
COPY website/ ./
COPY docs/ ../docs/
RUN npm run build

# ── Build Stage — Verifier (B02 Plan B) ───────
# The verifier is an npm workspace of the root package. We install via
# the workspace flag (resolves against the committed root lockfile so the
# build is reproducible) but copy only what the verifier needs to compile.
FROM node:20-alpine AS verifier-build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY verifier/package.json ./verifier/
RUN npm ci --workspace @zeroauth/verifier --include-workspace-root=false --ignore-scripts
COPY verifier/tsconfig.json ./verifier/
COPY verifier/src/ ./verifier/src/
RUN npm --workspace @zeroauth/verifier run build

# ── Verifier Production Stage ─────────────────
# Slim runtime image — just the compiled JS + production deps + the
# verification key. No source TS, no test deps, no snarkjs build tools.
# Bound to :3001 on the Docker network; the API container reaches it via
# its compose service name `zeroauth-verifier`. Loopback-only is enforced
# at the network boundary — no host port binding.
FROM node:20-alpine AS verifier-production
WORKDIR /app

RUN addgroup -g 1001 -S zeroauth && \
    adduser -S zeroauth -u 1001

# Install verifier's prod deps in a flat node_modules. Deliberately uses
# `npm install --omit=dev` rather than `npm ci` because the verifier
# workspace doesn't have its own lockfile (it shares the root's via
# npm workspaces, which complicates a single-package install). Trade-off
# is acceptable for v0; full reproducible-build provenance is on the
# roadmap per ADR-0005 / the verifier design doc.
COPY verifier/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force

# Compiled JS from the verifier-build stage
COPY --from=verifier-build /app/verifier/dist ./dist

# The Groth16 verification key — read at startup. Hard-coded absolute
# path via VERIFIER_VKEY_PATH so cwd changes can't make the file
# unfindable.
COPY circuits/build/verification_key.json /app/circuits/build/verification_key.json

USER zeroauth

ENV NODE_ENV=production
ENV VERIFIER_VKEY_PATH=/app/circuits/build/verification_key.json
ENV VERIFIER_BIND=0.0.0.0
ENV VERIFIER_PORT=3001

EXPOSE 3001

# NOTE: 127.0.0.1 not localhost. Alpine's busybox wget resolves
# `localhost` to IPv6 (::1) first; the verifier binds IPv4 0.0.0.0,
# so the IPv6 connection is refused and busybox bails without falling
# back to IPv4. Using the literal IPv4 address sidesteps the resolver.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/server.js"]

# ── Production Stage ──────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Security: run as non-root
RUN addgroup -g 1001 -S zeroauth && \
    adduser -S zeroauth -u 1001

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled API
COPY --from=api-build /app/dist ./dist

# Copy landing page
COPY public/ ./public/

# Copy dashboard build
COPY --from=dashboard-build /app/dashboard/dist ./dashboard/dist

# Copy built documentation site
COPY --from=docs-build /app/website/build ./website/build

# Copy ZKP circuit artifacts (pre-compiled)
COPY circuits/build/verification_key.json ./circuits/build/verification_key.json
COPY circuits/build/circuit_final.zkey ./circuits/build/circuit_final.zkey
COPY circuits/build/identity_proof_js/ ./circuits/build/identity_proof_js/

# Copy contract ABIs
COPY contracts/deployed-addresses.json* ./contracts/

USER zeroauth

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist/server.js"]
