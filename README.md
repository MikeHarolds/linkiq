# LinkIQ

LinkIQ is a production-grade SaaS link management and analytics
platform: smart URL shortening, real-time click analytics, QR codes,
UTM campaign tracking, custom/branded domains, team workspaces with
role-based access control, a public REST API with webhooks, a
multi-currency subscription billing system with real Paystack checkout,
and a full admin console (users, roles, plans, billing, landing-page
CMS, platform settings).

The same application source code runs unchanged in three environments —
local Windows development, GitHub Codespaces, and Render — with only
infrastructure/environment configuration differing between them (see
[Environments](#environments) below).

## Stack

| Layer        | Technology                                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend     | Next.js (App Router), React 19, TypeScript, Tailwind CSS, shadcn/ui, React Query, React Hook Form, Zod                                                                            |
| Backend      | NestJS, PostgreSQL, Prisma ORM, Redis, BullMQ, Pino (structured logging), Swagger                                                                                                 |
| Billing      | Paystack (real hosted checkout, invoice-first flow, webhook + callback verification) — see [docs/architecture/paystack-integration.md](docs/architecture/paystack-integration.md) |
| Infra        | Docker (dev + prod configs), Docker Compose, GitHub Actions CI, Nginx, GitHub Codespaces, Render                                                                                  |
| Tooling      | ESLint, Prettier, Husky, lint-staged, Conventional Commits (commitlint)                                                                                                           |
| Architecture | Modular monolith, clean architecture, service layer, shared packages                                                                                                              |

## Monorepo layout

```
linkiq/
├── apps/
│   ├── web/          # Next.js — the product
│   ├── api/           # NestJS — REST API
│   └── docs/            # Next.js — documentation site
├── packages/
│   ├── ui/               # Shared shadcn/ui component library
│   ├── config/             # Shared TypeScript/ESLint/Prettier/Tailwind config
│   ├── types/                # Shared types/DTOs (web ⇄ api contract)
│   └── utils/                  # Shared utility functions
├── docker/                        # Dockerfiles + dev/prod Compose (self-hosted)
├── .devcontainer/                    # GitHub Codespaces configuration
├── infrastructure/                     # Nginx reverse proxy config
├── docs/                                 # Documentation (this repo's docs, not apps/docs)
├── render.yaml                             # Render Blueprint (not yet deployed)
└── scripts/                                  # Local dev helper scripts
```

See [`docs/architecture/overview.md`](docs/architecture/overview.md) and
[`docs/architecture/folder-structure.md`](docs/architecture/folder-structure.md)
for the full breakdown.

## Environments

|                     | Local Windows                                                              | GitHub Codespaces                                          | Render                             |
| ------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------- |
| Purpose             | Day-to-day development                                                     | Cloud dev / investor demo, no local setup                  | Staging / fallback hosting         |
| Node/Postgres/Redis | Installed via Docker Compose (`docker/docker-compose.dev.yml`) or manually | Provisioned automatically (`.devcontainer/`)               | Managed Render services            |
| App startup         | `npm run dev`                                                              | Starts automatically                                       | `render.yaml` build/start commands |
| Config source       | `apps/*/.env` (copied from `.env.example`)                                 | Same, with a few values auto-filled for the forwarded URLs | Render environment variables       |

The application code has **no environment-specific branches** for any
of the three — every difference is `process.env.*`. See
[docs/architecture/overview.md](docs/architecture/overview.md) for how
this is enforced (no hardcoded `localhost`, no wildcard CORS, no
Codespaces/Render-specific imports anywhere in `apps/api` or
`apps/web`).

## Prerequisites

- Node.js ≥ 20, npm ≥ 10 (see `engines` in [`package.json`](package.json))
- Docker Desktop (used to run Postgres + Redis locally — see
  [Local Windows setup](#local-windows-setup))
- A Paystack account with **TEST**-mode API keys for development (see
  [Paystack TEST mode](#paystack-test-mode)) — not required just to
  browse the app, only to exercise checkout

## Local Windows setup

```bash
git clone <this-repo-url>
cd linkiq

cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
cp apps/docs/.env.example apps/docs/.env

npm install

# Postgres + Redis via Docker (the current local setup uses Docker for
# infra services only — the app itself runs natively via `npm run dev`,
# not inside a container, so hot reload/debugging work normally)
docker compose --env-file .env --project-directory . -f docker/docker-compose.dev.yml up -d postgres redis

npm run db:migrate   # prisma migrate dev — interactive, dev-only
npm run db:seed      # creates demo + admin accounts, base workspace, plans

npm run dev           # API on :4000, Web on :3000 (concurrently)
# — or individually —
npm run dev:api
npm run dev:web
```

`scripts/setup.sh` automates all of the above in one command (Git Bash
on Windows, or WSL). Alternatively, run the **entire** stack —
including the app processes — inside Docker:

```bash
npm run docker:up     # docker/docker-compose.dev.yml, all four services
npm run docker:down
```

See [docs/installation/local-development.md](docs/installation/local-development.md)
for the full guide and troubleshooting.

## GitHub Codespaces setup

Open this repository in a Codespace (**Code → Codespaces → Create
codespace**). `.devcontainer/` handles everything automatically:

1. Provisions Postgres + Redis as Docker Compose services
   (`.devcontainer/docker-compose.yml`) — reachable from the app
   container at the service names `postgres`/`redis`, never `localhost`.
2. **On first creation only** (`postCreateCommand` →
   `.devcontainer/setup.sh`): copies `.env` files, installs
   dependencies, runs `prisma migrate deploy` (non-interactive), and
   seeds demo data **only if the database is genuinely empty** — it
   never re-seeds or wipes data on a later rebuild/resume.
3. **On every start** (`postStartCommand` → `.devcontainer/start.sh`):
   runs `npm run dev` in the background — the exact same command a
   local Windows developer runs.
4. Ports `3000` (Web) and `4000` (API) are forwarded automatically;
   Postgres/Redis are not exposed outside the Codespace.

`setup.sh` also detects the Codespaces-provided `CODESPACE_NAME` /
`GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` variables and writes the
real forwarded-port URLs into `NEXT_PUBLIC_API_URL`, `APP_URL`, and
`CORS_ORIGIN` — so the browser can reach the API through its public
forwarded URL rather than an internal container address. This is the
**only** Codespaces-specific logic anywhere in the repo, and it lives
entirely in `.devcontainer/`, never inside `apps/api` or `apps/web`.

Open the forwarded port-3000 URL (**Ports** tab in VS Code) to use the
app — see [Investor demo](#codespaces-investor-demo) below for what to
show.

## Environment variables

Every variable is documented inline in its `.env.example` file — this
is the authoritative source, not a duplicate list here:

- [`.env.example`](.env.example) — Docker Compose project-level vars
- [`apps/api/.env.example`](apps/api/.env.example) — API, Prisma,
  Redis, JWT/auth, Paystack, webhooks, email (Resend/SMTP — see
  [`docs/architecture/email.md`](docs/architecture/email.md)), rate
  limiting, demo credentials
- [`apps/web/.env.example`](apps/web/.env.example) — API URL, app URL,
  refresh-cookie name
- [`apps/api/.env.production.example`](apps/api/.env.production.example) /
  [`apps/web/.env.production.example`](apps/web/.env.production.example) —
  the same variables, annotated for a real deployment

None of these files ever contain a real secret — every value is either
blank or an obvious `change_me_*`/`REPLACE_ME` placeholder. Real
`.env`/`.env.production`/`.env.development`/`.env.test` files (any
variant, any workspace) are gitignored — see [`.gitignore`](.gitignore).

## PostgreSQL

Prisma (`apps/api/prisma/schema.prisma`) is the single source of
truth. `DATABASE_URL` is the only thing that changes between
environments — always supplied via environment configuration, never
hardcoded:

- **Local**: `postgresql://linkiq:...@localhost:5432/linkiq`
- **Codespaces**: `postgresql://linkiq:...@postgres:5432/linkiq` (Docker service name)
- **Render**: the managed database's connection string, injected via `render.yaml`'s `fromDatabase`

## Redis

`apps/api/src/config/redis.config.ts` reads `REDIS_HOST`/`REDIS_PORT`/
`REDIS_PASSWORD` — `localhost` is only ever a local-dev default, never
assumed. BullMQ (`apps/api/src/modules/queue`) shares the same
connection config. If Redis is genuinely unreachable, the app fails
loudly — the `/api/v1/health` endpoint reports `redis: down` and
connection errors surface in logs; queues are never silently disabled.

## Prisma

- `npm run db:generate` — regenerate the Prisma client
- `npm run db:migrate` — `prisma migrate dev` (interactive; local dev only, can create new migrations)
- `npm run db:deploy` — `prisma migrate deploy` (non-interactive, applies pending migrations only — **the only migration command ever used in CI, Codespaces, or Render**)
- `npm run db:studio` — Prisma Studio

**Never `prisma migrate reset`** outside a throwaway local database —
no script in this repo runs it, and none should be added to any
deploy/startup pipeline.

## Seeding

```bash
npm run db:seed
```

Creates the platform's plans/currencies/roles, a demo workspace, and
two **development-only** accounts:

| Role  | Email            | Password    |
| ----- | ---------------- | ----------- |
| User  | demo@linkiq.com  | Demo@12345  |
| Admin | admin@linkiq.com | Admin@12345 |

These credentials are safe to publish (they're already in this
README) precisely because they must never exist in a real production
database. `npm run db:seed` creates **no fake paid invoices or
payments** — every subscription it seeds is either free-tier or
explicitly marked as internal demo data. Do not run this command
against a production `DATABASE_URL`.

## Running the API

```bash
npm run dev:api      # nest start --watch — http://localhost:4000/api/v1
npm run build:api    # nest build
npm run start:api    # node dist/main — production, after build:api
```

## Running the Web app

```bash
npm run dev:web      # next dev — http://localhost:3000
npm run build --workspace=apps/web
npm run start:web    # next start — production, after the build above
```

## Testing

```bash
npm run typecheck    # every workspace
npm run lint          # every workspace
npm test               # apps/api unit tests (Jest)
npm run test:e2e        # apps/api e2e tests (Jest, real Postgres/Redis, --runInBand)
```

## Paystack TEST mode

Set `BILLING_PROVIDER=paystack` and real **TEST**-mode
`PAYSTACK_SECRET_KEY`/`PAYSTACK_PUBLIC_KEY` (from your Paystack
dashboard's Test Mode) in `apps/api/.env` to exercise the real
invoice-first checkout flow end-to-end — plan selection, invoice
review, redirect to Paystack's actual hosted checkout, and Paystack's
own built-in test-mode payment simulator (Success/Bank
Authentication/Declined). Leave `BILLING_PROVIDER` unset (defaults to
`development`) to skip Paystack entirely — every billing mutation then
applies directly, with no external calls, useful for working on
non-billing features without any Paystack account at all. See
[docs/architecture/paystack-integration.md](docs/architecture/paystack-integration.md).

**Never use LIVE Paystack keys** in local development or a Codespaces
demo — TEST keys only.

## Render deployment

See [docs/deployment/render.md](docs/deployment/render.md) and
[`render.yaml`](render.yaml) — a ready-to-launch Blueprint (API + Web
services, managed Postgres, managed Redis-compatible Key Value store)
that has not been deployed. Migrations run via `prisma migrate deploy`
as a pre-deploy step; seeding is never automatic on Render.

## Production considerations

- **File storage**: uploaded branding logos/favicons currently write
  to local disk (`apps/api/uploads/`) — this does not persist across a
  Render redeploy or any ephemeral-filesystem platform. The storage
  layer is already built behind a swappable provider interface
  (`MediaStorageProvider`) for exactly this reason — see
  [docs/deployment/render.md §File storage](docs/deployment/render.md#file-storage).
- **CORS**: `CORS_ORIGIN` must be set explicitly in any real
  deployment — there is no wildcard fallback.
- **Seeding**: `npm run db:seed` is a development tool, not a
  deployment step — see [Seeding](#seeding) above.

## Documentation

- [Local Development Guide](docs/installation/local-development.md)
- [Development Workflow](docs/development-workflow.md)
- [Architecture Overview](docs/architecture/overview.md)
- [Folder Structure](docs/architecture/folder-structure.md)
- [Paystack Integration](docs/architecture/paystack-integration.md)
- [Billing Architecture](docs/architecture/billing.md)
- [Render Deployment Guide](docs/deployment/render.md)
- [Self-Hosted Production Deployment (stub)](docs/deployment/production-deployment.md)
- [Administrator Guide](docs/admin-guide/README.md)
- [API Documentation](docs/api/README.md)

## Codespaces investor demo

The seeded demo data supports a full walkthrough without ever touching
a real payment: landing page → register/login → dashboard → create a
link → visit its redirect → real-time analytics → QR codes → UTM
campaigns → custom domains → billing (plan selection → invoice review
→ real Paystack TEST checkout → invoice/receipt) → currency selection
→ admin console (users, roles, plan management, landing-page CMS). Log
in as either seeded account (above), or register a fresh one to show
the signup flow.

## License

Proprietary — all rights reserved.
