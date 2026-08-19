#!/usr/bin/env bash
# LinkIQ — GitHub Codespaces one-time setup (postCreateCommand).
#
# Runs exactly once, when the Codespace container is first created —
# never on a later stop/resume (see .devcontainer/start.sh for what
# runs every start). Mirrors scripts/setup.sh's local-Windows steps
# (copy env files, install, migrate, seed) with two Codespaces-specific
# adjustments: migrations use the non-interactive `prisma migrate
# deploy` (Codespaces setup has no TTY for `migrate dev`'s prompts —
# same reasoning already established for this repo's CI and e2e test
# harness), and seeding is skipped entirely if the database already has
# any user in it, so re-creating/rebuilding a Codespace never wipes or
# duplicates demo data (Sprint 19 §6).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Copying environment files (skipping any that already exist)"
[ -f .env ] || cp .env.example .env
[ -f apps/web/.env ] || cp apps/web/.env.example apps/web/.env
[ -f apps/api/.env ] || cp apps/api/.env.example apps/api/.env
[ -f apps/docs/.env ] || cp apps/docs/.env.example apps/docs/.env

# --- Codespaces-aware browser-facing URLs -----------------------------
# CODESPACE_NAME and GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN are set
# automatically by GitHub Codespaces itself (never hand-configured).
# Only written once, into the freshly-copied .env files above — DATABASE_URL
# and REDIS_HOST are handled separately, via docker-compose.yml's own
# environment block (see that file's comments), not here.
if [ -n "${CODESPACES:-}" ] && [ -n "${CODESPACE_NAME:-}" ]; then
  FORWARD_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  WEB_URL="https://${CODESPACE_NAME}-3000.${FORWARD_DOMAIN}"
  API_URL="https://${CODESPACE_NAME}-4000.${FORWARD_DOMAIN}"

  echo "==> Detected Codespaces — configuring forwarded-port URLs"
  echo "    Web: $WEB_URL"
  echo "    API: $API_URL"

  # apps/web/.env — the BROWSER needs the API's externally-reachable
  # forwarded URL. (API_ORIGIN, used only by Next's own server process
  # for the short-link rewrite proxy, stays "http://localhost:4000" —
  # the api and web dev servers run in this same container, so that
  # container-local address is still correct and is deliberately left
  # untouched.)
  sed -i "s|^NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=${API_URL}/api/v1|" apps/web/.env

  # apps/api/.env — APP_URL (used to build QR-code/short-link URLs and
  # the Paystack checkout callback, see docs/architecture/paystack-integration.md)
  # and CORS_ORIGIN (must allow the forwarded web origin) both need the
  # real forwarded URL, not the http://localhost:3000 default.
  sed -i "s|^APP_URL=.*|APP_URL=${WEB_URL}|" apps/api/.env
  sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=${WEB_URL}|" apps/api/.env
fi

echo "==> Installing dependencies"
npm install

echo "==> Generating Prisma client"
npm run db:generate

echo "==> Applying database migrations (prisma migrate deploy — non-interactive, non-destructive)"
npm run db:deploy

echo "==> Checking whether the database already has demo data"
SEEDED="0"
if [ -f apps/api/node_modules/.bin/prisma ] || [ -d apps/api/node_modules/@prisma/client ]; then
  SEEDED=$(node -e "
    const { PrismaClient } = require('./apps/api/node_modules/@prisma/client');
    const prisma = new PrismaClient();
    prisma.user.count()
      .then((n) => { console.log(n); return prisma.\$disconnect(); })
      .catch(() => { console.log(0); });
  " 2>/dev/null || echo "0")
fi

if [ "${SEEDED:-0}" = "0" ]; then
  echo "==> Fresh database detected — seeding demo data"
  npm run db:seed
else
  echo "==> Existing data found ($SEEDED user(s)) — skipping seed (never re-seeds automatically)"
fi

echo ""
echo "Codespaces setup complete. Services will start automatically."
echo "Demo user:  demo@linkiq.com  / Demo@12345"
echo "Demo admin: admin@linkiq.com / Admin@12345"
echo "(Development-only credentials — never used in production, see docs/deployment/render.md)"
