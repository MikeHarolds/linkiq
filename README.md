# LinkIQ

LinkIQ is a next-generation link management and analytics platform: smart
URL shortening, real-time analytics, AI-powered insights, campaign
management, QR codes, branded domains, team workspaces, and a public REST
API — built as a production-grade SaaS foundation.

> **Status:** Sprint 0 (Project Foundation) complete. Architecture and
> development environment are established. No business features
> (authentication, link shortening, dashboards, analytics, etc.) are
> implemented yet — see [Roadmap](#roadmap).

## Stack

| Layer        | Technology                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Frontend     | Next.js (App Router), React 19, TypeScript, Tailwind CSS, shadcn/ui, React Query, React Hook Form, Zod |
| Backend      | NestJS, PostgreSQL, Prisma ORM, Redis, BullMQ, Pino (structured logging), Swagger                      |
| Infra        | Docker (dev + prod configs), Docker Compose, GitHub Actions, Nginx                                     |
| Tooling      | ESLint, Prettier, Husky, lint-staged, Conventional Commits (commitlint)                                |
| Architecture | Modular monolith, clean architecture, service layer, shared packages                                   |

## Monorepo layout

```
linkiq/
├── apps/
│   ├── web/               # Next.js — the product
│   ├── api/                # NestJS — REST API
│   └── docs/                # Next.js — documentation site
├── packages/
│   ├── ui/                  # Shared shadcn/ui component library
│   ├── config/               # Shared TypeScript/ESLint/Prettier/Tailwind config
│   ├── types/                 # Shared types/DTOs (web ⇄ api contract)
│   └── utils/                  # Shared utility functions
├── docker/                      # Dockerfiles + dev/prod Compose
├── infrastructure/                # Nginx reverse proxy config
├── docs/                            # Documentation (this repo's docs, not apps/docs)
└── scripts/                          # Local dev helper scripts
```

See [`docs/architecture/overview.md`](docs/architecture/overview.md) and
[`docs/architecture/folder-structure.md`](docs/architecture/folder-structure.md)
for the full breakdown.

## Quick start (local development)

See [`docs/installation/local-development.md`](docs/installation/local-development.md)
for the full guide, including Prerequisites and Troubleshooting. Short version:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
cp apps/docs/.env.example apps/docs/.env

npm install

docker compose --env-file .env --project-directory . -f docker/docker-compose.dev.yml up -d postgres redis

npm run db:migrate
npm run db:seed

npm run dev:api    # http://localhost:4000/api/v1
npm run dev:web    # http://localhost:3000
npm run dev:docs   # http://localhost:3001
```

Or run everything (including the apps) in Docker with hot reload:

```bash
npm run docker:up
```

### Demo accounts

Seeded by `npm run db:seed`:

| Role  | Email            | Password    |
| ----- | ---------------- | ----------- |
| User  | demo@linkiq.com  | Demo@12345  |
| Admin | admin@linkiq.com | Admin@12345 |

### API health check & docs

```bash
curl http://localhost:4000/api/v1/health
```

Swagger UI: `http://localhost:4000/api/v1/docs`

## Documentation

- [Local Development Guide](docs/installation/local-development.md)
- [Development Workflow](docs/development-workflow.md)
- [Architecture Overview](docs/architecture/overview.md)
- [Folder Structure](docs/architecture/folder-structure.md)
- [Production Deployment Guide](docs/deployment/production-deployment.md)
- [Administrator Guide](docs/admin-guide/README.md)
- [API Documentation](docs/api/README.md)

## Roadmap

**Sprint 0 — Project Foundation (this milestone):**

- [x] Monorepo structure: `apps/{web,api,docs}`, `packages/{ui,config,types,utils}`
- [x] Next.js frontend: App Router, TypeScript, Tailwind, shadcn/ui, React Query,
      React Hook Form + Zod, marketing/auth/dashboard layouts, theme provider
- [x] NestJS backend: config module, structured logging (Pino), health module
      (Terminus, checks Postgres + Redis), global validation/error handling, Swagger
- [x] PostgreSQL + Prisma: UUID PKs, timestamped models, migration system, seed framework
- [x] Redis + BullMQ connection (no queues registered yet — foundation only)
- [x] Docker: dev config (hot reload) and prod config (multi-stage builds), Nginx
- [x] Code quality: ESLint, Prettier, Husky, lint-staged, Conventional Commits, path aliases
- [x] CI: install, lint, typecheck, build (per app) via GitHub Actions
- [x] Environment configuration for every app, dev and prod
- [x] Documentation: README, local dev guide, architecture, folder structure, dev workflow

**Upcoming milestones (each shipped and reviewed separately):**

- [ ] Authentication (JWT, refresh tokens, RBAC guards)
- [ ] Short links + redirect engine
- [ ] QR code generation
- [ ] Campaigns + UTM builder
- [ ] Real-time analytics
- [ ] AI-powered insights
- [ ] Custom domains
- [ ] Public REST API + webhooks
- [ ] Billing (plans, subscriptions)
- [ ] Admin dashboard modules

## License

Proprietary — all rights reserved.
