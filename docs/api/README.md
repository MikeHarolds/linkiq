# API Documentation

> **Status:** Stub — the public REST API surface is introduced starting
> with the Authentication milestone. Once implemented, this directory will
> include:

## Planned contents

- Authentication (JWT issuance, refresh flow)
- Endpoint reference (per resource: links, campaigns, QR codes, analytics, etc.)
- Request/response examples
- Error code reference
- Rate limit policy
- Webhook event reference
- SDK usage examples

## Current endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Liveness/readiness check (app + database) |

OpenAPI/Swagger UI will be wired up via `@nestjs/swagger` (already a
dependency) in the Authentication milestone, exposing interactive docs at
`/api/v1/docs`.
