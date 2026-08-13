# API Keys & Developer API Architecture

Sprint 8 adds workspace-scoped API keys as a second authentication method
alongside browser JWT sessions, and exposes the _existing_
Links/Campaigns/QR/Analytics/Domains functionality to API-key callers. It
deliberately does **not** introduce a parallel API surface — every
developer-facing endpoint is the same controller, service, and Prisma
model the browser dashboard already uses. This document explains the
dual-auth design, the permission model, and the billing/rate-limit
integration.

## 1. Core principle: one surface, two authentication methods

The endpoints the developer API exposes (`POST /api/v1/links`,
`GET /api/v1/campaigns`, etc.) are the exact paths the existing browser
controllers already serve — there was no room for a second, parallel
controller at those paths without a route collision, and no need for one:
the right design is teaching the existing global auth guard and
`WorkspaceRolesGuard` to also accept and authorize API keys, so every
existing route transparently serves both browser sessions and API keys
through the identical controller → service → Prisma path. No second Link
model, no second analytics pipeline, no parallel business logic anywhere.

## 2. Database model

```
ApiKey
  id, workspaceId, name
  keyPrefix (unique, safe to display — e.g. "lk_live_ab12cd34")
  keyHash   (unique, sha256 of the full raw secret — never the secret itself)
  permissions ApiKeyPermission[]  (LINKS_READ | LINKS_WRITE | CAMPAIGNS_READ |
                                    CAMPAIGNS_WRITE | QRCODES_READ | QRCODES_WRITE |
                                    ANALYTICS_READ | DOMAINS_READ | DOMAINS_WRITE |
                                    WORKSPACE_READ)
  lastUsedAt, expiresAt, revokedAt
  createdById (SetNull on user deletion — the key survives, the audit trail doesn't)

ApiUsageEvent   (async usage log — see §6)
  id, workspaceId, apiKeyId (SetNull), endpoint, method, statusCode, durationMs, createdAt
```

`Workspace` gains `apiKeys ApiKey[]` and `apiUsageEvents ApiUsageEvent[]`,
both `onDelete: Cascade` — deleting a workspace can never leave an
orphaned credential. `PlanLimitKey` gains `MONTHLY_API_REQUESTS` (§7).
Migration: `add_api_keys` — the only migration this sprint added; no
historical migration was touched.

**The raw secret is never persisted.** `common/utils/api-key.ts` generates
`lk_live_<192 bits of random, URL-safe data>` (the same
`randomBytes`-based approach as the existing `generateOpaqueToken` used
for refresh/reset tokens — not a UUID, not a timestamp, not anything
guessable) and hashes it with the existing `hashToken` (SHA-256) utility.
`ApiKeysService.create()` returns the raw secret in its response exactly
once; every subsequent read of that key only ever returns `keyPrefix`.

## 3. Dual-mode authentication — one guard, not two

`JwtAuthGuard` (global, via `APP_GUARD`) branches on a cheap prefix check:
a Bearer token starting with `lk_live_` is routed to
`ApiKeysAuthService.authenticate()` instead of Passport's JWT strategy —
not a second Passport strategy, a plain method call, so the two paths can
populate the request differently without one leaking into the other's
shape (see §4). `ApiKeysAuthService.authenticate()`:

1. Rejects immediately on a prefix mismatch (no DB hit for garbage).
2. Looks up the key by `sha256(rawKey)` — one indexed query, the same
   cost class as `JwtStrategy`'s own per-request, uncached user lookup.
3. `revokedAt` set → `ApiKeyRevokedException` (401, `API_KEY_REVOKED`).
4. `expiresAt` in the past → `ApiKeyExpiredException` (401,
   `API_KEY_EXPIRED`).
5. Creator missing or deactivated → `InvalidApiKeyException` (401,
   `INVALID_API_KEY`) — mirrors `JwtStrategy`'s identical handling of a
   deleted/deactivated JWT user.
6. Fire-and-forget `lastUsedAt` update — never awaited into the auth path.

**No caching layer for validation.** A single indexed lookup per request
is not a regression relative to today's JWT cost (which is also
uncached), and skipping a cache entirely means revocation is instant by
construction — there's nothing to invalidate.

## 4. Request context: two shapes that never overlap

- Browser JWT request: `request.user` (`AuthenticatedUser`), no
  `request.apiKeyAuth`.
- API-key request: `request.user` set to the key's **real creator**
  (fetched fresh, identical shape to the JWT path — `@CurrentUser()` and
  audit logs work unmodified), **plus** `request.apiKeyAuth`:

```ts
interface ApiKeyAuthContext {
  authenticationType: 'api_key';
  apiKeyId: string;
  workspaceId: string;
  createdById: string | null;
  permissions: ApiKeyPermission[];
}
```

The JWT user object is never overloaded with API-specific fields — the
two concerns stay in two separate, unambiguous places.

## 5. Authorization: `WorkspaceRolesGuard` grows one branch

The existing JWT branch (resolve workspace from header/param → check
membership → check `@Roles(...)`) is completely unchanged. When
`request.apiKeyAuth` is present, a separate branch runs instead:

1. **Workspace is always `apiKeyAuth.workspaceId`** — the `X-Workspace-Id`
   header is never read for API-key auth. If the route has an explicit
   `:workspaceId` param (only `DomainsController`) and it disagrees with
   the key's own workspace, the request is rejected with
   `WorkspaceAccessDeniedException` (403, `WORKSPACE_ACCESS_DENIED`) —
   a caller-supplied workspace id can never override the one encoded on
   the key, matching or not.
2. A new `@ApiPermission(...)` decorator (parallel to `@Roles`, added
   alongside it on every API-exposed route) is checked against
   `apiKeyAuth.permissions`. A route with no `@ApiPermission()` at all is
   **not reachable via API key** — fails closed rather than assuming an
   implicit scope.
3. `request.workspaceMember` is set to the key creator's real membership
   row when it still exists (so `@CurrentWorkspace()` behaves identically
   to the JWT path), or a minimal synthetic membership if the creator has
   since left the workspace — its `role` field is inert for an API-key
   request, since authorization already happened via `@ApiPermission`,
   never `@Roles`.

API-key permissions are **independent of the creator's ongoing
WorkspaceRole** — a key keeps exactly the scopes it was granted at
creation even if its creator is later demoted (or promoted).

| Controller                          | Read scope       | Write scope           |
| ----------------------------------- | ---------------- | --------------------- |
| Links                               | `LINKS_READ`     | `LINKS_WRITE`         |
| QR codes (both controllers)         | `QRCODES_READ`   | `QRCODES_WRITE`       |
| Campaigns                           | `CAMPAIGNS_READ` | `CAMPAIGNS_WRITE`     |
| Analytics (class-level)             | `ANALYTICS_READ` | — (read-only surface) |
| Custom domains                      | `DOMAINS_READ`   | `DOMAINS_WRITE`       |
| Workspace (`GET :workspaceId` only) | `WORKSPACE_READ` | —                     |

`ApiKeysController` itself (managing keys) carries no `@ApiPermission` at
all — credential management is a browser/JWT-only, `ADMIN`+ surface, the
same way Sprint 7 gates billing management above `MEMBER`. An API key can
never create, list, or revoke another key.

**Permissions are required at creation, never implicit.** `CreateApiKeyDto`
requires a non-empty `permissions` array — there is no "all access"
default a caller could accidentally grant.

## 6. Usage tracking — async, off the request path

`ApiUsageInterceptor` (global `APP_INTERCEPTOR`, registered in
`api-keys.module.ts`) is a complete no-op for any request without
`request.apiKeyAuth` — every browser/JWT request and the public redirect
never enter its logic at all. For an API-key request, it enqueues a job
via `ApiUsageProducer` after the handler settles (success or error) — a
direct structural copy of the existing `ClickEventProducer`/
`ClickEventProcessor` pattern (`links/queue/click-event.*`): the same
`QueueModule`/BullMQ infrastructure, a new `api-usage-events` queue,
fire-and-forget enqueue, idempotent processing (`job.data.eventId` doubles
as the `ApiUsageEvent` primary key and the BullMQ job id). Never logs the
key secret or the `Authorization` header — the existing pino redaction in
`logging.module.ts` already redacts `req.headers.authorization` globally,
unchanged from Sprint 0.

## 7. Billing integration — `MONTHLY_API_REQUESTS`

Before calling the handler, the same interceptor asks
`BillingUsageService.getUsageAndLimit(workspaceId, 'MONTHLY_API_REQUESTS')`
— the exact aggregate-count pattern `BillingUsageService.monthlyClickUsage`
already uses for `MONTHLY_CLICKS` (`docs/architecture/billing.md` §4), now
extended with a sibling `monthlyApiRequestUsage` counting `ApiUsageEvent`
rows over the resolved billing period. If exhausted, throws
`ApiPlanLimitExceededException` (403, `API_PLAN_LIMIT_REACHED`) — a small
sibling of Sprint 7's `PlanLimitExceededException`, same response shape.
This is the **only** place `MONTHLY_API_REQUESTS` is ever enforced —
browser JWT traffic and the public redirect path never call this
interceptor's guarded branch, so links/redirects/QR/campaigns/domains are
never disabled because a workspace's API usage is exhausted.

Because the detailed usage event is recorded asynchronously, there is a
small eventual-consistency window (a burst of concurrent requests could
slightly overshoot the limit before the queue catches up) — the same
accepted tradeoff Sprint 7 already made for `MONTHLY_CLICKS`.

`MONTHLY_API_REQUESTS` limits per plan (`prisma/seed.ts`):

| Plan         | Limit             |
| ------------ | ----------------- |
| FREE         | 1,000 / month     |
| STARTER      | 10,000 / month    |
| PROFESSIONAL | 100,000 / month   |
| BUSINESS     | 1,000,000 / month |
| ENTERPRISE   | Unlimited         |

## 8. Rate limiting — the existing `ThrottlerGuard`, not a second limiter

`ApiKeyAwareThrottlerGuard extends ThrottlerGuard` (the `@nestjs/throttler`
class already backing every `@Throttle(...)` override in
`auth.controller.ts`), overriding only `getTracker()` — an API-key request
is tracked by `apiKeyAuth.apiKeyId` instead of source IP, so a key's rate
limit follows it across networks and is isolated from a browser session
sharing the same NAT. Same `ThrottlerModule.forRoot()` config, same
`THROTTLE_TTL`/`THROTTLE_LIMIT` env vars, same storage — not a second
rate-limiting system. `throwThrottlingException()` is also overridden, to
produce a structured `{ code: 'API_RATE_LIMIT_EXCEEDED', message }` body
for API-key requests specifically; browser/JWT throttling keeps the
library's default exception shape unchanged.

**Registered in `auth.module.ts`, not `app.module.ts`** — deliberately,
immediately after `JwtAuthGuard` in the same `providers` array. Multiple
`APP_GUARD` providers run in the order Nest instantiates them, and this
guard's tracker/exception logic depends on `request.apiKeyAuth` already
being set by `JwtAuthGuard`; registering it from `app.module.ts` left that
relative order unspecified and, verified empirically while building this
sprint, wrong. `ThrottlerModule` is `@Global()`, so the guard's own
dependencies still resolve correctly from `auth.module.ts` even though
that module never imports `ThrottlerModule` directly.

## 9. Errors

Every API-key-specific exception is a thin subclass passing a structured
body, the same additive pattern `PlanLimitExceededException` already
established in Sprint 7 (no `HttpExceptionFilter` change needed — its
object-spread already handles any structured exception body):

| Code                      | Status | Thrown when                                                         |
| ------------------------- | ------ | ------------------------------------------------------------------- |
| `INVALID_API_KEY`         | 401    | Unrecognized key, or its creator no longer exists/is inactive       |
| `API_KEY_REVOKED`         | 401    | Key has been revoked                                                |
| `API_KEY_EXPIRED`         | 401    | Past `expiresAt`                                                    |
| `API_PERMISSION_DENIED`   | 403    | Missing the route's required `@ApiPermission`                       |
| `WORKSPACE_ACCESS_DENIED` | 403    | A route `:workspaceId` param disagrees with the key's own workspace |
| `API_PLAN_LIMIT_REACHED`  | 403    | `MONTHLY_API_REQUESTS` exhausted                                    |
| `API_RATE_LIMIT_EXCEEDED` | 429    | Per-key rate limit exceeded                                         |

## 10. Audit logging

`api_key.created`, `api_key.revoked`, `api_key.deleted` on the actual
mutations — never the secret or its hash, only `name`/`keyPrefix`/
`permissions`. No dedicated `api_key.expired` log entry: like
`SubscriptionStatus`'s derived `EXPIRED`/`CANCELED` states, expiry is a
read-time derived fact, not an action anyone takes.

## 11. Frontend

`/dashboard/developers`: API key list (name, prefix, permissions, derived
status badge, created/last-used/expiration dates, revoke/delete actions),
a create-key dialog requiring an explicit non-empty permission selection
and a reveal-once secret with a copy button (never fetchable again — the
same pattern the Sprint 5 "link created" dialog already established for
short URLs), and a quick-start panel (base URL, auth header example, link
to Swagger at `/api/v1/docs`). Gated to `ADMIN`/`OWNER` for mutations —
`VIEWER` can see the list read-only, matching the billing dashboard's
precedent rather than the Links/Domains `MEMBER`-can-mutate one.

## 12. API surface

```
POST   /api/v1/workspaces/:workspaceId/api-keys              create (ADMIN/OWNER)
GET    /api/v1/workspaces/:workspaceId/api-keys               list (VIEWER+)
GET    /api/v1/workspaces/:workspaceId/api-keys/:id           get (VIEWER+)
POST   /api/v1/workspaces/:workspaceId/api-keys/:id/revoke    revoke (ADMIN/OWNER)
DELETE /api/v1/workspaces/:workspaceId/api-keys/:id           delete (ADMIN/OWNER)
```

Every existing Links/Campaigns/QR/Analytics/Domains/Workspace-read
endpoint is additionally reachable via `Authorization: Bearer lk_live_...`
— see `docs/api/developer-guide.md` for the developer-facing reference,
and Swagger at `/api/v1/docs` for full request/response schemas.

## 13. Known limitations

- **No caching layer for API-key validation** — a future high-QPS
  deployment might add one; see §3 for why this sprint deliberately
  doesn't.
- **`MONTHLY_API_REQUESTS` has the same small eventual-consistency window**
  as `MONTHLY_CLICKS` — usage events are queued, not synchronous (§7).
- **Permissions are a fixed enum + Postgres array column, not a
  relational join table** — adding a new scope is a migration, not just
  data. Chosen because a permission set is small and fixed-vocabulary,
  never queried independently of its owning key.
- **No API key rotation** ("roll secret, keep metadata/permissions") this
  sprint — revoke the old key and create a new one is the supported flow.
- **No webhook receiver for a real API gateway/provider** — out of scope,
  matching Sprint 7's billing provider boundary.
