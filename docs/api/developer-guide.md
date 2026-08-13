# LinkIQ Developer API Guide

This guide is for external applications integrating with LinkIQ via API
keys. It covers authentication, permissions, request/response conventions,
pagination, rate limiting, and errors. For the full request/response
schema of every endpoint, see the interactive Swagger docs at
`/api/v1/docs` (linked from the "Developers" page in the dashboard). For
the internal design of how this all fits together, see
`docs/architecture/api-keys.md`.

## Base URL

```
https://<your-linkiq-deployment>/api/v1
```

In local development, this is `http://localhost:4000/api/v1`.

## Authentication

Create an API key from **Dashboard → Developers → Create API key**. The
full secret is shown exactly once, immediately after creation — copy it
somewhere safe. LinkIQ cannot show it to you again; if you lose it, revoke
the key and create a new one.

Authenticate every request with a standard Bearer token:

```bash
curl https://your-deployment/api/v1/links \
  -H "Authorization: Bearer lk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

API keys are a separate credential from your browser login — they never
expire on logout, and revoking a browser session has no effect on your
API keys (and vice versa).

## Permissions

Every API key is created with an explicit, non-empty set of permissions —
there is no "full access" default. A request fails with
`API_PERMISSION_DENIED` if the key wasn't granted the scope a given
endpoint requires.

| Scope             | Grants                                                           |
| ----------------- | ---------------------------------------------------------------- |
| `links:read`      | List and retrieve links                                          |
| `links:write`     | Create, update, delete, pause/activate/archive links             |
| `campaigns:read`  | List and retrieve campaigns                                      |
| `campaigns:write` | Create, update, delete, and transition campaigns                 |
| `qrcodes:read`    | List, retrieve, and download QR codes                            |
| `qrcodes:write`   | Create, update, delete QR codes                                  |
| `analytics:read`  | Read-only analytics endpoints                                    |
| `domains:read`    | List and retrieve custom domains                                 |
| `domains:write`   | Create, update, delete, verify, activate, disable custom domains |
| `workspace:read`  | Read basic workspace info                                        |

An API key can only ever act on **the one workspace it was created in**.
There is no way to supply a different workspace id and have it honored —
any attempt returns `WORKSPACE_ACCESS_DENIED`.

## Endpoints

All of these are the same endpoints the LinkIQ dashboard itself uses —
there is no separate "developer API."

```
# Links
POST   /api/v1/links
GET    /api/v1/links
GET    /api/v1/links/:id
PATCH  /api/v1/links/:id
DELETE /api/v1/links/:id

# Campaigns
POST   /api/v1/campaigns
GET    /api/v1/campaigns
GET    /api/v1/campaigns/:id
PATCH  /api/v1/campaigns/:id
DELETE /api/v1/campaigns/:id

# QR codes
POST   /api/v1/links/:linkId/qrcodes
GET    /api/v1/links/:linkId/qrcodes
GET    /api/v1/qrcodes/:id

# Analytics (read-only)
GET    /api/v1/analytics/overview
GET    /api/v1/analytics/timeseries
GET    /api/v1/analytics/links
GET    /api/v1/analytics/referrers
GET    /api/v1/analytics/geography
GET    /api/v1/analytics/devices
GET    /api/v1/analytics/browsers
GET    /api/v1/analytics/operating-systems
GET    /api/v1/analytics/campaigns
GET    /api/v1/analytics/utm/:field

# Custom domains
GET    /api/v1/workspaces/:workspaceId/domains
GET    /api/v1/workspaces/:workspaceId/domains/:id
POST   /api/v1/workspaces/:workspaceId/domains
PATCH  /api/v1/workspaces/:workspaceId/domains/:id
DELETE /api/v1/workspaces/:workspaceId/domains/:id

# Workspace
GET    /api/v1/workspaces/:workspaceId
```

### Quick start: create a link and fetch it back

```bash
curl -X POST https://your-deployment/api/v1/links \
  -H "Authorization: Bearer lk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"destinationUrl": "https://example.com/landing", "slug": "my-campaign"}'

curl https://your-deployment/api/v1/links/<id-from-response> \
  -H "Authorization: Bearer lk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

## Pagination

List endpoints (`GET /links`, `GET /campaigns`, etc.) use the same
`page`/`pageSize` query parameters as the dashboard, and return the same
shape:

```json
{
  "items": [...],
  "pagination": { "page": 1, "pageSize": 20, "totalItems": 42, "totalPages": 3 }
}
```

There is no separate pagination convention for API-key callers.

## Rate limiting

Requests are rate-limited per API key (not per source IP — an integration
running from multiple servers shares one limit, tied to the key). The
default is 100 requests per 60 seconds; a request over the limit receives
a `429` with:

```json
{ "statusCode": 429, "code": "API_RATE_LIMIT_EXCEEDED", "message": "..." }
```

## Plan limits

Beyond rate limiting (a short-window abuse guard), your workspace's plan
has a monthly API request quota. Exceeding it returns a `403`:

```json
{
  "statusCode": 403,
  "code": "API_PLAN_LIMIT_REACHED",
  "feature": "API requests",
  "limit": 1000,
  "usage": 1000,
  "remaining": 0,
  "message": "You've reached your plan's monthly API request limit (1000/1000). Upgrade your plan to continue."
}
```

This limit applies **only** to API-key traffic — it never affects your
existing links, redirects, QR codes, campaigns, or custom domains, which
keep working regardless of your API usage.

## Errors

Every error response follows the same envelope, with a `code` field you
can switch on for programmatic handling:

```json
{
  "statusCode": 401,
  "code": "INVALID_API_KEY",
  "message": "The API key is invalid or expired."
}
```

| Code                      | Status | Meaning                                                                   |
| ------------------------- | ------ | ------------------------------------------------------------------------- |
| `INVALID_API_KEY`         | 401    | The key is malformed, unrecognized, or its creator's account is gone      |
| `API_KEY_REVOKED`         | 401    | The key has been revoked — create a new one                               |
| `API_KEY_EXPIRED`         | 401    | The key's expiration date has passed                                      |
| `API_PERMISSION_DENIED`   | 403    | The key doesn't have the scope this endpoint requires                     |
| `WORKSPACE_ACCESS_DENIED` | 403    | You tried to reference a workspace other than the one this key belongs to |
| `API_PLAN_LIMIT_REACHED`  | 403    | Your workspace has used its monthly API request quota                     |
| `API_RATE_LIMIT_EXCEEDED` | 429    | Too many requests in a short window — back off and retry                  |

## Revocation

Revoking a key (Dashboard → Developers → key menu → Revoke) takes effect
immediately — the very next request with that key returns `401
API_KEY_REVOKED`. There is no propagation delay or cache to wait out.

## Security notes

- Treat your API key exactly like a password. Anyone with it can act on
  your workspace within the permissions you granted it.
- Never commit an API key to source control or share it in a support
  ticket, chat message, or bug report.
- If a key is ever exposed, revoke it immediately and create a
  replacement — there is no way to "roll" a key's secret while keeping
  the same credential.
