# E2E Tests

These tests boot the real NestJS application against a real (disposable)
PostgreSQL + Redis — unlike the unit tests under `src/**/*.spec.ts`, nothing
here is mocked. They are the tests that actually prove the security
boundaries described in Sprint 1 (RBAC enforcement, session rotation,
enumeration prevention, etc.) end-to-end.

## Running locally

```bash
# 1. Create a disposable test database
createdb linkiq_test   # or: psql -c "CREATE DATABASE linkiq_test"

# 2. Point DATABASE_URL at it and run migrations
DATABASE_URL="postgresql://linkiq:<password>@localhost:5432/linkiq_test?schema=public" \
  npx prisma migrate deploy

# 3. Run the suite against that database
DATABASE_URL="postgresql://linkiq:<password>@localhost:5432/linkiq_test?schema=public" \
  npm run test:e2e --workspace=apps/api
```

Each spec file resets the relevant tables in `beforeEach`/`afterAll` via
`resetDatabase()` in `setup-app.ts` — safe to run repeatedly, but always
point `DATABASE_URL` at a disposable database, never at development or
production data.

## CI

`.github/workflows/ci.yml` runs this suite automatically against ephemeral
Postgres/Redis service containers on every push and PR.
