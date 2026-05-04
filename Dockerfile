# ───────────────────────────────────────────────
# ZeroAuth Multi-Stage Dockerfile
# Supports: development, test, production targets
# ───────────────────────────────────────────────

# ── Development Stage ─────────────────────────
FROM node:25-alpine AS development
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
FROM node:25-alpine AS test
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json jest.config.* ./
COPY src/ ./src/
COPY tests/ ./tests/
COPY circuits/build/ ./circuits/build/
CMD ["npm", "test"]

# ── Build Stage — API ─────────────────────────
FROM node:25-alpine AS api-build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Build Stage — Dashboard ───────────────────
FROM node:25-alpine AS dashboard-build
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json* ./
RUN npm ci --ignore-scripts
COPY dashboard/ ./
RUN npm run build

# ── Production Stage ──────────────────────────
FROM node:25-alpine AS production
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

# Copy pre-built documentation site
COPY website/build/ ./website/build/

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
