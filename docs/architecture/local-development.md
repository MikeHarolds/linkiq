# Local Development Environment

Sprint 17. This document exists because three recurring symptoms —
Redis `ECONNREFUSED`, port 3000/4000 conflicts, and Next.js
`ChunkLoadError` — were reported without a documented root cause. Each
is explained below, with the actual fix (not a workaround).

## The intended startup sequence

Infrastructure (PostgreSQL + Redis) runs in Docker; the API and web app
run natively on the host via `npm run dev:*`. This is a deliberate
split, not an oversight — see `docker/docker-compose.dev.yml`, which
also defines `api`/`web` services for the alternative fully-containerized
workflow (`npm run docker:up`) — both are supported, but the two are
not meant to run at the same time (a natively-running API and a
containerized `linkiq-api-dev` would both try to bind host port 4000).

```bash
# 1. Infrastructure only
docker compose --env-file .env --project-directory . -f docker/docker-compose.dev.yml up -d postgres redis

# 2. Wait for both to report healthy (see "Redis ECONNREFUSED" below
#    for why this matters), then:
npm run dev:api    # http://localhost:4000/api/v1
npm run dev:web    # http://localhost:3000
```

Confirm the stack before starting the app layer:

```bash
docker ps --filter name=linkiq-postgres-dev --filter name=linkiq-redis-dev
# STATUS column must read "healthy" for both, not just "Up"
```

## Root cause: Redis `ECONNREFUSED`

`linkiq-redis-dev`'s healthcheck (`redis-cli ping`, from
`docker-compose.dev.yml`) passes as soon as the Redis process inside
the container is ready — but on Windows, Docker Desktop's WSL2 backend
publishes the container's port to the host through a separate relay
(`com.docker.backend.exe` / `wslrelay.exe`), which can lag a few
seconds behind the container itself reporting healthy, especially
right after Docker Desktop starts or restarts. During that window,
`docker exec linkiq-redis-dev redis-cli ping` already succeeds (it's
talking to Redis _inside_ the container's network namespace) while a
connection from the Windows host to `localhost:6379` still gets
refused — which is exactly the discrepancy this sprint's report
described ("container is healthy but Redis is not reachable from the
host").

This is infrastructure timing, not application misconfiguration — both
`redis.config.ts` (`REDIS_HOST`/`REDIS_PORT`, defaulting to
`localhost`/`6379`) and `RedisModule`'s `ioredis` client (which retries
its own connection automatically) are already correct. The fix is
procedural: **start the API only after `docker ps` shows both
containers `healthy`**, not immediately after `docker compose up`
returns. `ioredis`'s default reconnection logic means a _transient_
refusal during that window is not fatal either way — `npm run dev:api`
will keep retrying and connect once the relay catches up — but a
`maxRetriesPerRequest: 3`-bounded command issued in that same window
can still fail visibly (e.g. a BullMQ queue registration at boot),
which is what actually surfaces as an error in the terminal.

## Root cause: port 3000/4000 already in use

Both `npm run dev:api` and `npm run dev:web` (via `nest start --watch`
and `next dev` respectively) are long-running watch processes. An
interrupted terminal session, a crashed shell, or a second `npm run
dev:*` invocation in a new terminal leaves an orphaned process still
bound to the port. Windows does not free the port just because the
terminal window closed.

Diagnose and clear before restarting:

```bash
netstat -ano | grep -E ':(3000|4000)\s.*LISTENING'
# note the PID in the last column, then:
taskkill //F //PID <pid>
```

Never work around this by changing `PORT`/`API_ORIGIN` per session —
that just hides a real leaked process and breaks the web app's
hardcoded expectation of the API on `:4000` (see `next.config.js`'s
short-link rewrite, which targets `API_ORIGIN` / defaults to
`localhost:4000`).

## Root cause: Next.js `ChunkLoadError`

This is caused by **more than one `next dev` process serving the same
app concurrently**, not by application code. Each `next dev` instance
computes its own build/chunk hashes for the current source tree; if a
browser tab loaded its initial HTML from one instance and then a
second instance (started later, possibly after further edits) starts
serving `/​_next/static/*` requests from the same port via some proxy
or a stale service worker, the hashes in the already-loaded HTML no
longer match anything the currently-responding server can serve —
`ChunkLoadError`. The same class of problem shows up as a stale
`.next` cache surviving a dependency or Tailwind-config change across
restarts.

Before any browser verification pass:

1. Confirm exactly one `next dev` process is running (same `netstat`
   check as above, port 3000).
2. If in doubt, stop it, delete `apps/web/.next` (a disposable build
   cache, never source of truth for anything), and restart
   `npm run dev:web` fresh.
3. Never leave a previous session's dev server running while starting
   a new one "just to check" — kill it first.

## Hydration warnings

`apps/web/src/app/layout.tsx` already sets `suppressHydrationWarning`
on `<html>`, specifically because `ThemeProvider` (dark/light mode)
necessarily renders a different `class` attribute on the server (no
knowledge of the client's stored preference) than the client's first
paint — this is the one, deliberate, expected mismatch and is already
handled. Any _other_ hydration warning is a real bug in the component
that produced it, not something to suppress at the root — see Part 12
of this sprint's own audit for the browser-verification pass that
checked for exactly this.

## Verifying the stack from a clean slate

```bash
docker compose --env-file .env --project-directory . -f docker/docker-compose.dev.yml up -d postgres redis
docker ps --filter name=linkiq-postgres-dev --filter name=linkiq-redis-dev   # both "healthy"
cd apps/api && npx prisma migrate status                                     # "up to date"
npm run prisma:seed --workspace=apps/api                                     # idempotent, safe to re-run
npm run dev:api                                                              # separate terminal
npm run dev:web                                                              # separate terminal
```
