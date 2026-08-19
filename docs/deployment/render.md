# Deploying LinkIQ to Render

> **Status:** Configuration is prepared (`render.yaml` at the repo
> root) and this guide documents the exact steps — nothing has been
> deployed. Render is one of LinkIQ's three supported environments
> (alongside local Windows development and GitHub Codespaces); the
> application source code is identical in all three — see
> [Sprint 19's environment architecture](#architecture) below.

## Architecture

```
Render
  ├── linkiq-web       (Next.js — Render Web Service)
  ├── linkiq-api       (NestJS — Render Web Service)
  ├── linkiq-postgres  (managed PostgreSQL)
  └── linkiq-redis     (managed Key Value — Redis-compatible)
```

Two independent Render Web Services (API and Web), a managed
PostgreSQL database, and a managed Key Value (Redis-compatible)
instance for BullMQ. Both services build and run from the **repo
root** (this is an npm-workspaces monorepo — `npm ci` needs the root
lockfile) using the exact same scripts documented in the
[README](../../README.md) and already used by CI/local dev — nothing
Render-specific is baked into the application itself.

## 1. Prerequisites

- A Render account with billing configured (managed Postgres/Key Value
  are not part of Render's free tier).
- Paystack credentials — **TEST** keys for a staging/demo deployment,
  **LIVE** keys only for a genuine production deployment. Never mix
  the two; mode is inferred automatically from the key's own
  `sk_test_`/`sk_live_` prefix (see `apps/api/src/config/paystack.config.ts`)
  — there is no separate flag to get out of sync with it.

## 2. Launch the Blueprint

From the Render dashboard: **New → Blueprint**, point it at this
repository, and Render will read `render.yaml` from the repo root and
propose the four resources listed above. Review and create them.

Fields marked `sync: false` in `render.yaml` (every real secret, plus
every URL Render itself assigns and therefore can't know in advance)
prompt for a value at creation time, or can be left blank and filled
in afterward from each service's **Environment** tab.

## 3. Fill in the values Render can't generate for you

**After `linkiq-redis` exists**, open its dashboard page and copy its
connection host/port/password into `linkiq-api`'s environment:
`REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`. The application fails
loudly (not silently) if these are wrong — see
[§Redis](#redis--bullmq) below.

**After `linkiq-api` and `linkiq-web` both have their Render-assigned
URLs** (visible on each service's dashboard page immediately after
first deploy), go back and set:

| Variable                 | Service    | Value                                                                                          |
| ------------------------ | ---------- | ---------------------------------------------------------------------------------------------- |
| `API_PUBLIC_URL`         | linkiq-api | `linkiq-api`'s own URL (used to build uploaded-file URLs — see [§File storage](#file-storage)) |
| `APP_URL`                | linkiq-api | `linkiq-web`'s URL (used to build short-link/QR-code URLs and the Paystack checkout callback)  |
| `CORS_ORIGIN`            | linkiq-api | `linkiq-web`'s URL (must exactly match — see [§CORS](#cors))                                   |
| `NEXT_PUBLIC_API_URL`    | linkiq-web | `linkiq-api`'s URL + `/api/v1`                                                                 |
| `NEXT_PUBLIC_APP_URL`    | linkiq-web | `linkiq-web`'s own URL                                                                         |
| `API_ORIGIN`             | linkiq-web | `linkiq-api`'s own URL (server-side only, used by the short-link rewrite proxy)                |
| `REDIRECT_DEFAULT_HOSTS` | linkiq-api | `linkiq-api`'s own bare hostname (e.g. `linkiq-api.onrender.com`)                              |

The last one is easy to miss and breaks every short link with a 404 if
skipped: `linkiq-web`'s rewrite proxy (`API_ORIGIN`, above) makes a
genuine new outbound request to `linkiq-api`, so the API sees its own
hostname on the `Host` header, not `linkiq-web`'s. `RedirectService`
only resolves a request as "the platform's default host" when the
`Host` header matches `APP_URL`'s hostname or an entry in
`REDIRECT_DEFAULT_HOSTS` (see `domain-resolver.service.ts`) — without
this, every redirect request from the rewrite proxy resolves as an
unrecognized host and 404s, even though the link genuinely exists.
Live-discovered running the actual investor-demo flow against this
deployment. Also note: an env var change alone does not take effect on
a `render restart` — it requires a genuine new deploy (`render deploys
create`) to reach a fresh process.

Then set `PAYSTACK_SECRET_KEY`/`PAYSTACK_PUBLIC_KEY` (TEST or LIVE,
per §1 above), and trigger a redeploy of both services so they pick up
the new values.

## 4. Database migrations

`render.yaml`'s `preDeployCommand` already runs
`npm run db:deploy` (`prisma migrate deploy`) before every deploy of
`linkiq-api` — non-destructive, applies only pending migrations,
non-interactive-safe. **`npm run db:seed` is never run automatically
on Render** and must not be added to any build/start/pre-deploy
command — it's a development-only tool (creates the
`demo@linkiq.com`/`admin@linkiq.com` accounts documented in the
[README](../../README.md#demo-accounts)) that must never touch a real
customer database. If you want a seeded demo dataset on a Render
_staging_ deployment (not production), run it manually, once, from a
Render Shell session — never as part of the automated deploy pipeline.

## 5. Redis / BullMQ

The same `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` variables used
locally and in Codespaces — no separate Render-specific Redis
configuration exists in the application code
(`apps/api/src/config/redis.config.ts`). If these are missing or
wrong, the API fails its health check (`redis: down`, see
[§Health checks](#health-checks)) and BullMQ queues do not silently
stop working — connection errors surface in the service logs.

## 6. CORS

`CORS_ORIGIN` on `linkiq-api` must be set to `linkiq-web`'s exact
Render URL (`https://linkiq-web.onrender.com` or your custom domain).
There is no wildcard fallback — an unset `CORS_ORIGIN` falls back to
`http://localhost:3000` only, which will correctly reject the deployed
frontend's requests until it's set (a safe failure, not a silent
"allow everything").

## 7. Health checks

`linkiq-api`'s `healthCheckPath` is `/api/v1/health` — Render polls
this to decide whether the service is healthy and ready to receive
traffic. It's implemented with `@nestjs/terminus` and independently
reports `database` (Postgres via Prisma), `redis`, and process memory
— see `apps/api/src/modules/health/health.controller.ts`. It's public
(no auth), by design — the same as any load balancer/orchestrator
health probe — and returns no sensitive information (connection
strings, credentials).

## 8. File storage

Uploaded branding assets (logo/favicon, Sprint 14) currently use
`LocalDiskStorageProvider` — files are written to the container's own
disk. **On Render (or any platform without an attached persistent
disk), these files do not survive a redeploy** — every deploy runs in
a fresh container. This is a known, already-documented limitation, not
something Sprint 19 silently papered over: the storage layer is
already built behind a `MediaStorageProvider` interface specifically
so a durable provider (S3, GCS, Cloudinary, or Render's own persistent
disk add-on) can be swapped in later without touching the branding
module or CMS at all — see
`apps/api/src/modules/branding/storage/media-storage.interface.ts`.
Until that swap happens, treat uploaded logos on Render as
ephemeral — fine for a demo/staging deployment, not for production.

## 9. Paystack

Paystack architecture is unchanged by Sprint 19 — see
[docs/architecture/paystack-integration.md](../architecture/paystack-integration.md).
The only environment-specific pieces are the credentials themselves
(§1 above) and the callback URL, which is derived automatically from
`APP_URL` (§3) — no separate "Render callback URL" configuration
exists or is needed. Remember to register the deployed webhook URL
(`https://<linkiq-api-url>/api/v1/webhooks/paystack`) in the Paystack
dashboard for whichever mode (test/live) you're using.

## 10. What this guide does NOT do

Nothing in this document deploys anything. `render.yaml` is committed
configuration, reviewed and ready — creating the actual Blueprint
instance, filling in real credentials, and triggering the first deploy
are manual steps you take when ready.
