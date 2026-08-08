# Folder Structure

A file-by-file explanation of the repository layout. See
[`architecture/overview.md`](./architecture/overview.md) for the reasoning
behind these boundaries.

## Root

```
linkiq/
├── .github/workflows/ci.yml     CI: install, lint, typecheck, build (per app)
├── .husky/                       Git hooks (pre-commit, commit-msg)
├── apps/                         Deployable applications
├── packages/                     Shared, non-deployable code
├── docker/                       Dockerfiles + dev/prod Compose files
├── infrastructure/               Deployment-time config outside containers (nginx)
├── docs/                         Documentation (this file lives here)
├── scripts/                      Local dev helper scripts
├── commitlint.config.js          Conventional Commits enforcement
├── package.json                  Workspace root: cross-app scripts, shared devDeps
└── .env.example                  Vars consumed by docker-compose (Postgres/Redis/ports)
```

## `apps/web` — the product

```
apps/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx             Root layout: ThemeProvider, QueryProvider, Toaster
│   │   ├── (marketing)/           Public pages — nav + footer layout
│   │   │   ├── layout.tsx
│   │   │   └── page.tsx           Landing page
│   │   ├── (auth)/                Login/register — centered card layout
│   │   │   ├── layout.tsx
│   │   │   ├── login/page.tsx
│   │   │   └── register/page.tsx
│   │   └── (dashboard)/           Authenticated shell — sidebar + top bar
│   │       ├── layout.tsx
│   │       └── dashboard/page.tsx  Overview (placeholder content only)
│   ├── providers/
│   │   └── query-provider.tsx     React Query client (SSR-safe)
│   └── styles/globals.css          Imports design tokens from @linkiq/ui
├── next.config.js                  transpilePackages for workspace packages
├── tailwind.config.ts               Extends @linkiq/config/tailwind/base
├── tsconfig.json                    Extends @linkiq/config/typescript/nextjs.json
├── .eslintrc.js                     Extends @linkiq/config/eslint/nextjs
└── .env.example
```

**Route groups** (`(marketing)`, `(auth)`, `(dashboard)`) are a Next.js App
Router convention: the parentheses mean the segment doesn't appear in the
URL, but each group gets its own `layout.tsx`. This is how `/login` and
`/dashboard` render completely different chrome without any URL prefix.

## `apps/api` — the backend

```
apps/api/
├── src/
│   ├── main.ts                     Bootstrap: Helmet, CORS, Swagger, Pino, filters
│   ├── app.module.ts                Root module
│   ├── config/                      Typed config namespaces
│   │   ├── app.config.ts
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   └── auth.config.ts
│   ├── common/                      Cross-cutting, not tied to one feature
│   │   ├── filters/http-exception.filter.ts   Consistent JSON error envelope
│   │   ├── decorators/               (empty — populated as features need them)
│   │   ├── guards/                   (empty — auth guards land in the auth milestone)
│   │   ├── interceptors/             (empty)
│   │   └── pipes/                    (empty)
│   └── modules/
│       ├── prisma/                   PrismaService + PrismaModule (global)
│       ├── redis/                    ioredis client provider (global)
│       ├── queue/                    BullMQ connection (no queues registered yet)
│       ├── logging/                  Pino structured logging
│       └── health/                   Liveness/readiness endpoint
│           ├── health.controller.ts
│           ├── health.module.ts
│           └── indicators/redis.health.ts   Custom Terminus indicator
├── prisma/
│   ├── schema.prisma                 Identity/multi-tenancy models only
│   ├── seed.ts                       Demo + admin account seeding
│   └── migrations/                    Plain SQL migration files
├── tsconfig.json                      Extends @linkiq/config/typescript/nestjs.json
├── .eslintrc.js                       Extends @linkiq/config/eslint/nestjs
└── .env.example
```

Feature modules (once implemented) each get their own directory under
`modules/` following the same `*.controller.ts` / `*.service.ts` /
`*.module.ts` / `dto/` pattern established by `health/`.

## `apps/docs` — documentation site

A minimal Next.js app that will render the contents of the root `docs/`
directory. Shares `@linkiq/ui` and `@linkiq/utils` with the main app so the
docs site looks and feels consistent without duplicating components.

## `packages/*` — shared code

```
packages/
├── ui/
│   ├── src/components/    Button, Input, Label, Card, Dialog, Form, ...
│   ├── src/styles/globals.css   Design tokens (CSS variables, light+dark)
│   └── components.json     shadcn/ui config (style, aliases) for future additions
├── config/
│   ├── typescript/         base.json, nextjs.json, nestjs.json presets
│   ├── eslint/              base.js, nextjs.js, nestjs.js presets
│   ├── tailwind/            base.js — shared design tokens
│   └── prettier.js
├── types/
│   └── src/index.ts         Shared DTOs/types (UserDto, ApiErrorResponse, ...)
└── utils/
    └── src/                 cn.ts, format.ts, validation.ts
```

**Why these four and not more:** `ui` and `utils` are consumed by every
frontend app; `types` is the web ⇄ api contract; `config` is consumed by
every app and package for consistent tooling. Anything more granular
(e.g. splitting `utils` further) can happen later if a package genuinely
outgrows a single concern — premature splitting adds import-path overhead
without benefit this early.

## `docker/` and `infrastructure/`

- **`docker/`** — everything needed to _build and run_ the containers:
  `Dockerfile.api`, `Dockerfile.web` (both multi-stage, production images),
  `docker-compose.dev.yml` (bind-mounted source, hot reload), and
  `docker-compose.prod.yml` (builds the production images).
- **`infrastructure/`** — configuration that lives _outside_ the
  containers on the host: currently the Nginx reverse-proxy config for
  production deployments. As the project grows this is where
  provisioning/IaC notes would live too.

## `docs/`

```
docs/
├── installation/local-development.md    Full local setup guide
├── deployment/production-deployment.md   VPS/cloud deployment (grows with features)
├── admin-guide/README.md                  Admin dashboard usage (grows with features)
├── api/README.md                          REST API reference (grows with features)
└── architecture/
    ├── overview.md                        This file's companion
    └── folder-structure.md                This file
```
