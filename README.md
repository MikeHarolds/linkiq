# LinkIQ

LinkIQ is a next-generation link management and analytics platform: smart URL
shortening, real-time analytics, AI-powered insights, campaign management,
QR codes, branded domains, team workspaces, and a public REST API — built as
a production-grade SaaS foundation.

> **Status:** Foundation milestone complete. Business features (short links,
> analytics, campaigns, billing, etc.) have not been implemented yet — see
> [Roadmap](#roadmap) below.

## Stack

| Layer      | Technology |
|------------|------------|
| Frontend   | Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui, React Query, React Hook Form, Zod |
| Backend    | NestJS, PostgreSQL, Prisma ORM, Redis, BullMQ |
| Infra      | Docker, Docker Compose, GitHub Actions |
| Architecture | Modular monolith, clean architecture, service layer, repository pattern |

## Monorepo layout

```
linkiq/
├── apps/
│   ├── web/              # Next.js frontend
│   └── api/               # NestJS backend
├── packages/
│   └── shared-types/       # Types shared between web and api
├── infrastructure/
│   └── docker/             # Dockerfiles
├── docs/                   # Installation, deployment, admin, API docs
├── scripts/                 # Dev/ops helper scripts
├── docker-compose.yml
└── .env.example
```

## Quick start (local development)

See [`docs/installation/local-development.md`](docs/installation/local-development.md)
for the full guide. Short version:

```bash
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env

npm install

docker compose up -d postgres redis

npm run db:migrate
npm run db:seed

npm run dev:api   # http://localhost:4000/api/v1
npm run dev:web   # http://localhost:3000
```

### Demo accounts

Seeded by `npm run db:seed`:

| Role  | Email             | Password     |
|-------|-------------------|--------------|
| User  | demo@linkiq.com   | Demo@12345   |
| Admin | admin@linkiq.com  | Admin@12345  |

## Documentation

- [Local Development Guide](docs/installation/local-development.md)
- [Production Deployment Guide](docs/deployment/production-deployment.md)
- [Administrator Guide](docs/admin-guide/README.md)
- [API Documentation](docs/api/README.md)

## Roadmap

This foundation milestone establishes the project skeleton only:

- [x] Monorepo structure (frontend, backend, shared types)
- [x] Next.js frontend scaffold (TypeScript, Tailwind, design tokens)
- [x] NestJS backend scaffold (config, Prisma, health check, error handling)
- [x] Dockerized Postgres, Redis, API, and Web
- [x] Prisma schema for identity, organizations, workspaces, RBAC, audit logs
- [x] Demo user + admin seed framework
- [x] Documentation structure

Upcoming milestones (each shipped and reviewed separately):

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
- [ ] CI/CD (GitHub Actions)

## License

Proprietary — all rights reserved.
