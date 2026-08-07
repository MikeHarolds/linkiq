# Local Development Guide

## Prerequisites

- **Node.js** 20 or later (`node -v`)
- **npm** 10 or later (ships with Node 20)
- **Docker** and **Docker Compose** ([install guide](https://docs.docker.com/get-docker/))
- **PostgreSQL** 16 — provided via Docker Compose; a local install also works
- **Redis** 7 — provided via Docker Compose; a local install also works
- **Git**

## 1. Clone and install dependencies

```bash
git clone <your-fork-or-repo-url> linkiq
cd linkiq
npm install
```

This installs dependencies for all workspaces (`apps/web`, `apps/api`,
`packages/shared-types`) in one pass via npm workspaces.

## 2. Configure environment variables

Copy each `.env.example` to `.env` and adjust values as needed:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
```

| File | Purpose |
|------|---------|
| `.env` | Values consumed by `docker-compose.yml` (Postgres/Redis credentials, ports) |
| `apps/api/.env` | NestJS backend (`DATABASE_URL`, JWT secrets, Redis, throttling) |
| `apps/web/.env` | Next.js frontend (`NEXT_PUBLIC_API_URL`) |

For local development, the default values in the `.env.example` files work
out of the box — just make sure `apps/api/.env`'s `DATABASE_URL` matches the
Postgres credentials in the root `.env`.

## 3. Start infrastructure (Postgres + Redis)

```bash
npm run docker:up
```

This starts only what's defined in `docker-compose.yml`. For local dev you
typically want just the databases running in Docker, with the frontend and
backend running natively for fast reloads:

```bash
docker compose up -d postgres redis
```

## 4. Run Prisma migrations and seed data

```bash
npm run db:migrate   # applies migrations, generates the Prisma client
npm run db:seed      # creates demo + admin accounts and base workspace
```

This creates:

- Demo user: `demo@linkiq.com` / `Demo@12345`
- Admin user: `admin@linkiq.com` / `Admin@12345`

## 5. Run the apps

In separate terminals:

```bash
npm run dev:api   # NestJS on http://localhost:4000/api/v1
npm run dev:web   # Next.js on http://localhost:3000
```

Check the API health endpoint:

```bash
curl http://localhost:4000/api/v1/health
```

## Full Docker workflow (optional)

To run everything — Postgres, Redis, API, and Web — in containers:

```bash
npm run docker:up
```

Then run migrations/seed against the containerized database (the
`DATABASE_URL` in `apps/api/.env` should point at `localhost:5432` when run
from the host, or `postgres:5432` if run from inside the `api` container).

## Development workflow

- Backend follows a modular structure under `apps/api/src/modules/*`
  (controller → service → Prisma). Business logic stays in services, not
  controllers.
- Frontend follows the Next.js App Router convention under
  `apps/web/src/app`, with shared UI in `apps/web/src/components`.
- Shared types (DTOs used by both frontend and backend) live in
  `packages/shared-types`.
- Run `npm run lint` before committing.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Prisma Client did not initialize` | Run `npm run prisma:generate --workspace=apps/api` |
| API can't reach Postgres | Confirm `docker compose ps` shows `postgres` healthy, and `DATABASE_URL` host/port match |
| Port already in use | Change `PORT` / `WEB_PORT` / `API_PORT` in the relevant `.env` file |
| `EADDRINUSE` on Redis | Another local Redis instance is running; stop it or change `REDIS_PORT` |
| Seed fails with unique constraint errors | Seed is idempotent (`upsert`); if it still fails, reset with `npx prisma migrate reset --workspace=apps/api` (drops and reseeds) |
