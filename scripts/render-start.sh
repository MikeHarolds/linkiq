#!/usr/bin/env bash
# LinkIQ — Render startCommand for linkiq-api.
#
# Runs on every boot (including every free-tier cold start/restart, and
# every future auto-deploy). Applies pending migrations, non-destructive,
# same as any Render startCommand ships this repo already used
# (see render.yaml's own comment on why this runs here instead of a
# preDeployCommand — not supported on the free plan). Then seeds demo
# data ONLY if the database is genuinely empty (zero users) — the exact
# same idempotency guard docs/deployment/render.md and
# .devcontainer/setup.sh already use for Codespaces, extended here
# because Render's CLI has no non-interactive way to run a true one-off
# command against this free-tier service (no billing on file for Jobs,
# and `render ssh` refuses non-interactive use outright). This check is
# what makes it safe to run on every boot: it is a no-op the instant the
# database has any real (or demo) user in it, so it can never re-seed or
# touch an established database — see Sprint 19 §6 and
# docs/deployment/render.md's seeding section for the same rule stated
# for the manual/Codespaces paths.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run db:deploy

echo "==> Checking whether the database already has demo data"
SEEDED=$(node -e "
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  prisma.user.count()
    .then((n) => { console.log(n); return prisma.\$disconnect(); })
    .catch(() => { console.log(0); });
" 2>/dev/null || echo "0")

if [ "${SEEDED:-0}" = "0" ]; then
  echo "==> Fresh database detected — seeding demo data"
  npm run db:seed
else
  echo "==> Existing data found (${SEEDED} user(s)) — skipping seed"
fi

exec npm run start:api
