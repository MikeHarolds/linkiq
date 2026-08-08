# Architecture Overview

## Guiding principles

LinkIQ is built as a **modular monolith**, not a microservices system and not
a single unstructured Express app. The goal is to get the benefits of clear
module boundaries (independent reasoning, testability, the option to extract
a service later) without the operational cost of distributed systems this
early in the product's life.

- **Clean architecture, pragmatically applied.** Controllers stay thin
  (HTTP concerns only), business logic lives in services, and data access
  goes through Prisma via a dedicated `PrismaService`. We don't introduce a
  full hexagonal/ports-and-adapters layer for every module — that overhead
  isn't justified yet — but the controller → service → Prisma layering is
  non-negotiable so business logic never leaks into HTTP handlers.
- **Feature modules are self-contained.** Each business domain (once
  implemented: links, campaigns, QR codes, analytics, billing, ...) gets its
  own NestJS module under `apps/api/src/modules/*` with its own controller,
  service, and DTOs. Cross-module communication happens through injected
  services, not direct database access from another module's tables.
- **Shared code lives in packages, not in either app.** If both `apps/web`
  and `apps/api` need it (types), or multiple frontend apps need it
  (UI components, utils, config), it belongs in `packages/*` — never
  duplicated, never reached into across app boundaries via relative imports.

## Monorepo layout

```
linkiq/
├── apps/
│   ├── web/       Next.js — the product itself (marketing, auth, dashboard)
│   ├── api/       NestJS — REST API, business logic, database access
│   └── docs/      Next.js — documentation site
├── packages/
│   ├── ui/        Shared shadcn/ui component library
│   ├── config/    Shared TypeScript/ESLint/Prettier/Tailwind configuration
│   ├── types/     Shared TypeScript types/DTOs (web ⇄ api contract)
│   └── utils/     Shared framework-agnostic utility functions
├── prisma/        (see apps/api/prisma — schema/migrations live with the API)
├── infrastructure/  Deployment-time config that sits outside containers (nginx)
├── docker/        Dockerfiles + dev/prod Docker Compose
├── scripts/       Local dev helper scripts
└── docs/          This documentation
```

See [`folder-structure.md`](./folder-structure.md) for a file-by-file
breakdown of `apps/api/src`.

## Why a monorepo

- **One source of truth for types.** `packages/types` is imported by both
  `apps/web` and (as the API surface grows) referenced when writing API
  DTOs, so the frontend and backend can't silently drift apart.
- **One shared design system.** `packages/ui` means the dashboard, the
  marketing site, and the docs site render the same button, the same input,
  the same dark mode — without copy-pasting components between apps.
- **One set of quality gates.** `packages/config` centralizes TypeScript,
  ESLint, and Prettier configuration so every app and package enforces the
  same standards instead of accumulating inconsistent per-app rules.
- **Atomic changes.** A change that touches a shared type and both apps that
  consume it lands in one commit, one PR, one CI run — not three
  cross-repo PRs that have to be sequenced and versioned.

## Backend architecture (`apps/api`)

```
apps/api/src/
├── main.ts                 Bootstrap: Helmet, CORS, validation, Swagger, Pino logger
├── app.module.ts            Root module — wires every other module together
├── config/                  Typed configuration namespaces (app/database/redis/auth)
├── common/                  Cross-cutting concerns: filters, guards, interceptors, pipes
└── modules/
    ├── prisma/               PrismaService — the only place PrismaClient is instantiated
    ├── redis/                 Global ioredis client provider
    ├── queue/                 BullMQ connection (queues registered per-feature, later)
    ├── logging/               Pino structured logging (nestjs-pino)
    └── health/                Liveness/readiness endpoint (Terminus)
```

**Request flow:** `main.ts` → global middleware (Helmet, CORS, Pino HTTP
logging) → global `ValidationPipe` (whitelists + transforms DTOs) → route →
controller (HTTP only) → service (business logic) → `PrismaService`
(database) or `REDIS_CLIENT` (cache/queues) → global `HttpExceptionFilter`
normalizes any thrown error into a consistent JSON envelope on the way out.

**Configuration** is loaded once via `@nestjs/config` into typed namespaces
(`app.*`, `database.*`, `redis.*`, `auth.*`) — no module reads
`process.env` directly; everything goes through `ConfigService`.

**Logging** is structured (JSON in production, pretty-printed in
development) via `nestjs-pino`, with sensitive headers automatically
redacted and per-request correlation.

**Background jobs**: `QueueModule` establishes the BullMQ ↔ Redis
connection. No queues are registered yet — each feature module that needs
async processing (e.g. webhook delivery, analytics aggregation) will
register its own queue via `BullModule.registerQueue(...)` when that
feature ships, rather than a shared "jobs" grab-bag module.

## Frontend architecture (`apps/web`)

Next.js App Router with three route groups, each with its own layout:

- `(marketing)` — public pages (landing, pricing). Top nav + footer.
- `(auth)` — login/register. Centered card, no marketing chrome.
- `(dashboard)` — authenticated app shell. Sidebar + top bar.

Route groups exist precisely so each surface can have a different layout
without different URL structure — `/login` renders inside `(auth)/layout.tsx`
without `/auth` appearing in the URL.

**Data fetching**: React Query, with one `QueryClient` per browser session
(re-created per request on the server, memoized in the browser) — see
`src/providers/query-provider.tsx`. No feature modules fetch data yet; this
provider is the foundation upcoming feature milestones build on.

**Forms**: React Hook Form + Zod resolvers, using the shared `<Form>`
components from `@linkiq/ui` (a thin, typed wrapper over Radix primitives
matching shadcn/ui conventions).

**Styling**: Tailwind CSS with design tokens defined once in
`packages/config/tailwind/base.js` (colors, radius, animations as CSS
variables) and consumed by every app's `tailwind.config.ts`. Light/dark mode
is class-based (`next-themes`), matching the CSS variable strategy.

## Database

PostgreSQL via Prisma. The **foundation milestone intentionally defines only
identity/multi-tenancy tables** (`User`, `Organization`, `Workspace`,
`WorkspaceMember`, `AuditLog`, `FeatureFlag`) — no link/campaign/analytics
tables yet. This keeps the schema reviewable and lets RBAC and multi-tenancy
get it right before business data depends on them.

All primary keys are UUIDs (`gen_random_uuid()`), all tables have
`createdAt`/`updatedAt` timestamps, and migrations are plain SQL files under
`apps/api/prisma/migrations/` — reviewable, diffable, and free of ORM magic
at deploy time.

## What's deliberately not here yet

Per the Sprint 0 scope, the following are **not** implemented — only the
architecture and scaffolding they'll plug into:

- Authentication (JWT issuance/refresh, guards, decorators)
- Any business domain module (links, campaigns, QR codes, analytics, billing)
- Public API endpoints beyond `/health`
- Real dashboard content (widgets, charts, tables)

Each lands as its own reviewable milestone.
