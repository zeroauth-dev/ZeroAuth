#!/usr/bin/env bash
set -euo pipefail

# ZeroAuth — one-click deploy script.
# Usage:
#   ./scripts/deploy.sh dev    # local Docker dev stack
#   ./scripts/deploy.sh prod   # production stack with Caddy + auto TLS

PROFILE="${1:-prod}"

echo "========================================="
echo "  ZeroAuth — Deployment ($PROFILE)"
echo "  Zero biometric data stored. Ever."
echo "========================================="

command -v docker >/dev/null 2>&1 || { echo "Error: docker is required."; exit 1; }
command -v docker compose >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1 \
  || { echo "Error: docker compose is required."; exit 1; }

# ─── .env bootstrap ─────────────────────────────────────────
if [ ! -f .env ]; then
  if [ "$PROFILE" = "prod" ] && [ -f .env.production.template ]; then
    echo "Creating .env from .env.production.template..."
    cp .env.production.template .env
  else
    echo "Creating .env from .env.example..."
    cp .env.example .env
  fi

  # Generate fresh secrets (URL-safe base64 / hex)
  JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
  SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')
  ADMIN_API_KEY=$(openssl rand -hex 24)
  POSTGRES_PASSWORD=$(openssl rand -hex 24)

  # macOS sed needs '' arg after -i; Linux does not.
  SED_INPLACE=(-i)
  if [[ "$OSTYPE" == "darwin"* ]]; then SED_INPLACE=(-i ''); fi

  sed "${SED_INPLACE[@]}" "s|__ROTATE_ME__|placeholder|" .env  # disarm marker before targeted replaces

  # Replace anywhere we still have placeholders.
  sed "${SED_INPLACE[@]}" "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|"               .env
  sed "${SED_INPLACE[@]}" "s|^SESSION_SECRET=.*|SESSION_SECRET=${SESSION_SECRET}|"   .env
  sed "${SED_INPLACE[@]}" "s|^ADMIN_API_KEY=.*|ADMIN_API_KEY=${ADMIN_API_KEY}|"      .env
  sed "${SED_INPLACE[@]}" "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${POSTGRES_PASSWORD}|" .env

  echo ""
  echo "Generated fresh secrets in .env."
  echo "  ADMIN_API_KEY=${ADMIN_API_KEY}"
  echo "  (save this — needed for /api/admin/* and the dashboard)"
  echo ""

  if [ "$PROFILE" = "prod" ]; then
    echo "⚠  Production .env created from template."
    echo "   You MUST set BLOCKCHAIN_PRIVATE_KEY before on-chain features will work."
    echo "   Edit .env, then re-run this script."
    if grep -q "__SET_ME__" .env; then
      echo ""
      echo "Aborting: BLOCKCHAIN_PRIVATE_KEY is still __SET_ME__."
      exit 1
    fi
  fi
fi

# ─── prod sanity checks ─────────────────────────────────────
if [ "$PROFILE" = "prod" ]; then
  if grep -qE "^(JWT_SECRET|SESSION_SECRET|ADMIN_API_KEY)=__ROTATE_ME__|^BLOCKCHAIN_PRIVATE_KEY=__SET_ME__" .env; then
    echo "Aborting: .env still contains placeholder secrets."
    grep -E "^(JWT_SECRET|SESSION_SECRET|ADMIN_API_KEY|BLOCKCHAIN_PRIVATE_KEY)=" .env
    exit 1
  fi
fi

echo "Building and starting profile: ${PROFILE}"
docker compose --profile "${PROFILE}" up -d --build

echo ""
echo "========================================="
echo "  ZeroAuth is running (profile: ${PROFILE})"
echo "========================================="
if [ "$PROFILE" = "prod" ]; then
  echo "  Public URL: https://zeroauth.dev (after DNS points here)"
  echo "  Local:      http://<host-ip>/api/health  (proxied via Caddy)"
else
  echo "  API:        http://localhost:3000"
  echo "  Dashboard:  http://localhost:3000/dashboard"
  echo "  Docs:       http://localhost:3000/docs"
  echo "  Health:     http://localhost:3000/api/health"
fi
echo ""
echo "  Blockchain: Base Sepolia L2 (chain 84532)"
echo "  ZKP:        Groth16 on BN128"
echo "========================================="
