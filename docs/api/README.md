# API Documentation

> **Status:** Sprints 0–9 complete. This file is the original Sprint 0
> placeholder and is stale for anything past `/health` — see
> [`developer-guide.md`](./developer-guide.md) for API-key authentication,
> permissions, endpoints, pagination, rate limiting, and error codes,
> [`webhooks.md`](./webhooks.md) for outbound event delivery, or
> `/api/v1/docs` for the live, always-current Swagger reference.

## Interactive documentation

Once the API is running (`npm run dev:api`), interactive Swagger docs are
available at:

```
http://localhost:4000/api/v1/docs
```

This is generated automatically from the NestJS controllers via
`@nestjs/swagger` and stays in sync with the code — treat it as the source
of truth over any static description in this file.

## Conventions established in this milestone

- **Base path:** all routes are prefixed `/api/v1` (`API_PREFIX` env var,
  versioned via `VersioningType.URI`).
- **Response envelope (errors):** every error response has the shape:
  ```json
  {
    "statusCode": 400,
    "message": "Validation failed",
    "error": "Bad Request",
    "path": "/api/v1/...",
    "timestamp": "2026-01-01T00:00:00.000Z"
  }
  ```
- **Validation:** all request bodies are validated via `class-validator`
  DTOs; unknown properties are rejected (`forbidNonWhitelisted: true`).
- **Rate limiting:** default 100 requests/60s per client (`@nestjs/throttler`),
  configurable via `THROTTLE_TTL` / `THROTTLE_LIMIT`.
- **Auth:** not implemented yet. Swagger is pre-configured with Bearer auth
  support (`addBearerAuth()`) for when the Authentication milestone lands.

## Current endpoints

| Method | Path             | Description                                                                                                  |
| ------ | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/v1/health` | Liveness/readiness check — reports app status plus PostgreSQL (via Prisma), Redis, and process memory health |

## Planned contents (filled in as each milestone ships)

- Authentication (JWT issuance, refresh flow)
- Endpoint reference per resource (links, campaigns, QR codes, analytics, etc.)
- Request/response examples
- Error code reference
- Webhook event reference
- SDK usage examples
