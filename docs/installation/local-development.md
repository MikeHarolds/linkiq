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

This installs dependencies for every workspace (`apps/web`, `apps/api`,
`apps/docs`, `packages/ui`, `packages/config`, `packages/types`,
`packages/utils`) in one pass via npm workspaces, and sets up Husky git
hooks via the `prepare` script.

## 2. Configure environment variables

Copy each `.env.example` to `.env`:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
cp apps/docs/.env.example apps/docs/.env
```

| File             | Purpose                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env`           | Values consumed by `docker/docker-compose.dev.yml` and `docker/docker-compose.prod.yml` (Postgres/Redis credentials, ports)                          |
| `apps/api/.env`  | NestJS backend (`DATABASE_URL`, JWT secrets, Redis, logging, throttling, analytics visitor-hash salt/GeoIP provider, `APP_URL` for QR code encoding) |
| `apps/web/.env`  | Next.js frontend (`NEXT_PUBLIC_API_URL`)                                                                                                             |
| `apps/docs/.env` | Documentation site                                                                                                                                   |

Default values in every `.env.example` work out of the box for local
development — just make sure `apps/api/.env`'s `DATABASE_URL` credentials
match the root `.env`'s `POSTGRES_*` values.

## 3. Start infrastructure (Postgres + Redis)

Using the provided dev Compose file (only starts the databases, not the apps
— run the apps natively for the fastest reload loop):

```bash
docker compose --env-file .env --project-directory . -f docker/docker-compose.dev.yml up -d postgres redis
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
npm run dev:api    # NestJS on http://localhost:4000/api/v1
npm run dev:web    # Next.js on http://localhost:3000
npm run dev:docs   # Docs site on http://localhost:3001
```

Check the API:

```bash
curl http://localhost:4000/api/v1/health
```

Swagger UI is available at `http://localhost:4000/api/v1/docs`.

## Full Docker workflow (optional)

To run everything — Postgres, Redis, API, and Web, with bind-mounted source
and hot reload — in containers:

```bash
npm run docker:up      # docker compose -f docker/docker-compose.dev.yml up -d --build
npm run docker:down
```

This is equivalent to `docker compose --env-file .env --project-directory . -f docker/docker-compose.dev.yml up -d --build`.
It mounts the repo into the `api` and `web` containers and runs `npm install
&& npm run dev:*` inside each, so file changes on your host are picked up
immediately.

For a production-like build (multi-stage images, no bind mounts, standalone
Next.js output), see
[`docs/deployment/production-deployment.md`](../deployment/production-deployment.md).

## Development workflow

- Backend follows a modular structure under `apps/api/src/modules/*`
  (controller → service → Prisma). Business logic stays in services, not
  controllers.
- Frontend follows the Next.js App Router convention under
  `apps/web/src/app`, using route groups (`(marketing)`, `(auth)`,
  `(dashboard)`) for layout separation.
- Shared UI components live in `packages/ui`; shared utilities in
  `packages/utils`; shared types/DTOs in `packages/types`. Since these ship
  TypeScript source directly (no build step) and are consumed via Next's
  `transpilePackages`, changes are picked up immediately in dev — no
  rebuild/republish step.
- Run `npm run lint`, `npm run typecheck`, and `npm run build` before
  pushing (see [`docs/development-workflow.md`](../development-workflow.md)
  for the full workflow, commit conventions, and pre-commit hooks).

## Troubleshooting

| Symptom                                              | Fix                                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `Prisma Client did not initialize`                   | Run `npm run db:generate`                                                                                                             |
| API can't reach Postgres                             | Confirm the `postgres` container is healthy (`docker compose -f docker/docker-compose.dev.yml ps`) and `DATABASE_URL` host/port match |
| Port already in use                                  | Change `PORT` / `WEB_PORT` / `API_PORT` in the relevant `.env` file                                                                   |
| `EADDRINUSE` on Redis                                | Another local Redis instance is running; stop it or change `REDIS_PORT`                                                               |
| Seed fails with unique constraint errors             | Seed is idempotent (`upsert`); if it still fails, reset with `npx prisma migrate reset --workspace=apps/api` (drops and reseeds)      |
| ESLint can't resolve `@linkiq/config/eslint/*`       | Run `npm install` again at the repo root — this is a workspace symlink issue, not a config bug                                        |
| Next.js can't resolve `@linkiq/ui` / `@linkiq/utils` | Confirm they're listed in that app's `next.config.js` `transpilePackages` array                                                       |
