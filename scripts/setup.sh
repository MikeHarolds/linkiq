#!/usr/bin/env bash
# LinkIQ — one-shot local setup helper.
# Copies env files, installs deps, starts infra, migrates + seeds the DB.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Copying environment files (skipping any that already exist)"
[ -f .env ] || cp .env.example .env
[ -f apps/web/.env ] || cp apps/web/.env.example apps/web/.env
[ -f apps/api/.env ] || cp apps/api/.env.example apps/api/.env

echo "==> Installing dependencies"
npm install

echo "==> Starting Postgres + Redis via Docker Compose"
docker compose up -d postgres redis

echo "==> Waiting for Postgres to become healthy"
until docker compose ps postgres | grep -q "healthy"; do
  sleep 2
done

echo "==> Running Prisma migrations"
npm run db:migrate

echo "==> Seeding demo data"
npm run db:seed

cat <<'MSG'

Setup complete.

  API:   npm run dev:api   (http://localhost:4000/api/v1)
  Web:   npm run dev:web   (http://localhost:3000)

  Demo user:  demo@linkiq.com  / Demo@12345
  Demo admin: admin@linkiq.com / Admin@12345

MSG
