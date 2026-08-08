# Development Workflow

## Branching and commits

- Branch from `main`: `feat/short-description`, `fix/short-description`,
  `chore/short-description`.
- Commits **must** follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `build:`, `ci:`, `chore:`,
  `perf:`, `style:`, `revert:`). This is enforced by commitlint via a Husky
  `commit-msg` hook — non-conforming commit messages are rejected locally,
  before they ever reach CI.

  ```
  feat(api): add link creation endpoint
  fix(web): correct dark mode flash on initial load
  docs: document Redis connection pooling
  ```

## Pre-commit checks

A Husky `pre-commit` hook runs `lint-staged`, which on every commit:

- Runs `prettier --write` + `eslint --fix` on staged `.ts`/`.tsx`/`.js`/`.jsx` files
- Runs `prettier --write` on staged `.json`/`.md`/`.yml`/`.yaml` files

This means formatting and lint-autofixable issues never make it into a
commit in the first place. If ESLint finds a **non-autofixable** error, the
commit is blocked until you fix it.

## Working on a feature

1. `git checkout -b feat/your-feature`
2. Make changes in the relevant app/package.
3. Run the relevant workspace's dev server (`npm run dev:web` /
   `npm run dev:api` / `npm run dev:docs`) and verify manually.
4. Before pushing:
   ```bash
   npm run lint
   npm run typecheck
   npm run build
   ```
   (CI runs all three anyway, but catching issues locally is faster.)
5. Commit with a Conventional Commits message. Push. Open a PR against `main`.

## Working across a shared package + an app

If your change touches `packages/ui`, `packages/utils`, or `packages/types`
**and** an app that consumes it, make the change in one commit/PR — that's
the whole point of the monorepo (see
[`architecture/overview.md`](./architecture/overview.md#why-a-monorepo)).
Because `apps/web`/`apps/docs` use `transpilePackages` and no package has a
separate build step, changes in `packages/*` are picked up immediately by
`npm run dev:web` with no rebuild/republish step.

## Database changes

Business tables aren't implemented yet (Sprint 0 scope), but the workflow
for schema changes going forward:

1. Edit `apps/api/prisma/schema.prisma`.
2. `npm run db:migrate` — this runs `prisma migrate dev`, which generates a
   new SQL migration file under `apps/api/prisma/migrations/` and applies it
   to your local database. **Review the generated SQL before committing** —
   Prisma's diffing is usually right, but destructive changes (dropped
   columns, changed types) deserve a second look.
3. Commit the new migration folder alongside the schema change.
4. `npm run db:seed` if you need to re-seed demo data after a reset.

Never hand-edit a migration file that's already been applied anywhere
(local, staging, prod) — add a new migration instead.

## Adding a new backend module

Follow the pattern established by `apps/api/src/modules/health/`:

```
modules/your-feature/
├── your-feature.controller.ts   HTTP layer only — delegates to the service
├── your-feature.service.ts       Business logic
├── your-feature.module.ts        Wires controller + service + imports
└── dto/                          Request/response DTOs with class-validator decorators
```

Register the new module in `apps/api/src/app.module.ts`. Keep controllers
free of business logic — if you're reaching for `PrismaService` or
`REDIS_CLIENT` directly inside a controller method, that logic belongs in
the service instead.

## Adding a new UI component

Components in `packages/ui/src/components/` follow shadcn/ui conventions
(Radix primitive + `cva` variants + `cn()` for class merging). When adding a
new one:

1. Create `packages/ui/src/components/your-component.tsx`.
2. Export it from `packages/ui/src/index.ts`.
3. Consume it from any app via `import { YourComponent } from '@linkiq/ui'`.

## CI

Every push and PR to `main` runs (`.github/workflows/ci.yml`):

1. **install** — `npm ci` across all workspaces
2. **lint** — `npm run lint` (every workspace with a `lint` script)
3. **typecheck** — Prisma generate, then `npm run typecheck` (every workspace)
4. **build-web**, **build-docs**, **build-api** — in parallel, each against
   real Postgres/Redis service containers where relevant

A PR can't merge with a red build. There is currently no automated test
suite (Sprint 0 is architecture-only) — `test:` commits are reserved for
when test coverage is introduced alongside the first business feature.

## Environment variables

Never commit real secrets. Each app has an `.env.example` documenting every
variable it reads — copy it to `.env` locally. Production secrets are
injected via `.env.production` (gitignored) referenced by
`docker/docker-compose.prod.yml`, or via your platform's secret manager if
you're not using the provided Compose file directly.
