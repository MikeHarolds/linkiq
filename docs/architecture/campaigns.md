# Campaign Architecture

Sprint 5 introduces Campaign Management and makes UTM tracking a
first-class LinkIQ capability. This document covers both end to end.

## 1. Core principle: a campaign is an organizational and analytics layer, not a tracking mechanism

A `Campaign` has no redirect, no short code, and is never itself hit by a
browser. It exists purely to:

1. Group links together for reporting.
2. Provide UTM defaults new links in it can inherit.

Everything that actually generates traffic (the redirect engine, click
events, analytics processing) is exactly what Sprints 2–4 already built —
this sprint adds a `campaignId` column to `Link` and a set of UTM columns,
and that's the entire surface area the redirect/analytics pipeline needed
to change.

## 2. Database relationships

```
Campaign
  id, workspaceId, name, description, status
  startDate, endDate
  utmSource, utmMedium, utmCampaign, utmTerm, utmContent   (defaults)
  createdById, createdAt, updatedAt, deletedAt

Link (extended)
  campaignId  -> Campaign?  (onDelete: SetNull)
  utmSource, utmMedium, utmCampaign, utmTerm, utmContent   (resolved snapshot)
```

**Campaign names are unique per workspace, not globally** — enforced by a
_partial_ unique index (`workspaceId, name` WHERE `deletedAt IS NULL`),
not a plain `@@unique`, specifically so a soft-deleted campaign's name
becomes reusable again, the same way deleting-and-recreating something
with the same name would behave to a user. Prisma's schema DSL can't
express a partial index directly, so this lives in the raw migration SQL;
`CampaignsService.create()` still relies on the database constraint as
the real source of truth (catching the `23505` unique-violation error),
the same pattern used for `Link.shortCode` uniqueness — a pre-check
would have a race window under concurrent requests.

**A link belongs to zero or one campaign** (`campaignId` is nullable).
**Deleting or archiving a campaign never touches its links** — enforced
at the schema level with `onDelete: SetNull`, not application logic that
could be bypassed or forgotten. Verified directly: an e2e test creates a
campaign-linked link, deletes the campaign, and confirms the link still
redirects and still appears in the workspace's link list.

## 3. UTM resolution: snapshot, not a live lookup

This is the most important design decision in this sprint, so it's
repeated here in full (also documented inline in `schema.prisma`):

When a link is created with a `campaignId`, its UTM fields are resolved
**once**, at that moment — any field explicitly given on the link wins;
anything left unset inherits the campaign's current default. The result
is written directly onto the `Link` row. It is **not** re-resolved from
the campaign on every read, and it is **not** baked into the link's
`destinationUrl`.

Why this matters:

- **Editing a campaign's UTM defaults later never silently changes
  already-configured links.** ("Do not mutate existing URLs
  unexpectedly" — Sprint 5 spec.) A link's tracking, once set up, stays
  exactly as configured until someone explicitly edits that link.
- **Editing a link's `destinationUrl` keeps working exactly as it did
  before this sprint** — UTM params are applied to whatever the current
  destination is, computed fresh at redirect time, never stored merged
  into the destination string itself.
- Reassigning a link to a **different** campaign (or removing it) _does_
  re-resolve UTM fields for anything not explicitly touched in that same
  request — this is a deliberate, narrower exception: the user is
  actively changing the link's campaign association in this specific
  action, so inheriting the new campaign's defaults for untouched fields
  is the intuitive behavior. An explicit `null` on a UTM field always
  wins over any inherited default, even in this case — a real bug was
  caught and fixed here during development: `??` treats `null` and
  `undefined` identically, which would have silently let an explicit
  "clear this field" fall through to the new campaign's default instead
  of actually clearing it. Fixed with explicit `!== undefined` checks;
  covered by dedicated tests (`links.service.spec.ts`).

## 4. UTM URL handling

`applyUtmParams` (`campaigns/utils/utm.ts`) is applied to the link's
`destinationUrl` **dynamically, at redirect time** — see
`RedirectService.resolveDestinationUrl`. Properties, all verified by unit
tests against the literal examples in the Sprint 5 spec:

- Existing query parameters are always preserved.
- A UTM field with a value **replaces** any same-named param already in
  the destination — never duplicates it (`URLSearchParams.set()`, not
  `.append()`).
- A UTM field with no value (never configured) leaves whatever the
  destination already had for that param untouched.
- The URL fragment (`#...`) is preserved and stays after the query
  string.
- Trailing slashes are preserved exactly.
- Values are percent-encoded automatically.

**Hot-path performance**: `hasAnyUtmValue` is checked first, and the
entire URL-rewrite step is skipped when a link has no UTM configuration
at all — the overwhelming majority of links. When UTM values are
present, the parse/rewrite is pure in-memory string manipulation (no
I/O), and the resolved UTM fields travel in the same Redis-cached
`CachedLink` object the redirect path already reads, so this adds no
extra database round-trip. If `applyUtmParams` ever throws (it shouldn't
— `destinationUrl` is already validated as an absolute http(s) URL at
creation time), the redirect falls back to the raw destination rather
than fail — a successful redirect matters more than its tracking tags.

## 5. Campaign analytics — one pipeline, not two

`CampaignAnalyticsService` queries the **same** `click_events` table
Sprint 3 built, joined to `links` on `links."campaignId"` — there is no
second analytics pipeline, no summary table that could drift out of
sync. Every method mirrors `AnalyticsService`'s existing patterns
exactly: raw parameterized SQL (needed for `AT TIME ZONE` bucketing, no
Prisma-builder equivalent), `resolveDateRange` for timezone-aware
ranges, and `AnalyticsCacheService` for caching — both reused directly
from `AnalyticsModule`, not reimplemented.

**Campaign vs. link count aggregation**: `CampaignsService.findAll()`
computes each campaign's link count with one extra aggregate query
across all returned campaigns (`GROUP BY "campaignId"`), never N+1 —
the same discipline `AnalyticsService.getTopLinks` already established.

**UTM breakdowns query the _link's_ stored UTM columns**, not
`ClickEvent.queryParams`. This is a deliberate, important separation:
`ClickEvent.queryParams` remains reserved for the Sprint 4 QR-attribution
mechanism (the UTM params baked into a _QR code's_ encoded short URL,
captured from the incoming request). A link's own resolved UTM fields
(§3) are a completely different, persistent piece of link configuration.
Both mechanisms happen to use UTM-shaped data, but they answer different
questions ("what did this specific request's query string carry" vs.
"what is this link's configured tracking"), and mixing them would be
incorrect.

**Cache isolation**: `AnalyticsCacheService.buildKey` hashes the _entire_
params object into the cache key. Since `campaignId` is always part of
that object for every campaign-analytics call, cache isolation between
campaigns (and between workspaces, which was already guaranteed) falls
out of the existing mechanism with no additional code — verified by an
e2e test asserting two campaigns' cache keys never collide.

## 6. QR integration

No changes to the QR redirect pipeline at all. A QR code's link may or
may not belong to a campaign — `GET /campaigns/:id/links` returns each
link's associated QR codes (fetched in one extra query across all
returned links, not per-link, since the local test environment's data
layer doesn't support a has-many "include" the way it does for
belongs-to relations). A QR scan against a campaign-linked link flows
through the identical redirect path as any other click, so it
automatically appears in that link's — and therefore that campaign's —
analytics.

## 7. Lifecycle

`DRAFT → ACTIVE ⇄ PAUSED → ARCHIVED`, plus `DRAFT → ARCHIVED` and
`ACTIVE/PAUSED → ARCHIVED` directly. `ARCHIVED` is terminal. `COMPLETED`
is never reached by an explicit action — it's **derived**: a campaign
whose `endDate` has passed is reported as `COMPLETED` regardless of its
stored `ACTIVE`/`PAUSED` status (`CampaignsService.getEffectiveStatus`),
the same derived-state pattern already used for link expiry
(`LinksService.isEffectivelyExpired`) — no background job needs to run
for this to be correct at any given moment.

Per the spec's explicit design requirement, **campaign status never
disables a link**. A campaign being paused, archived, or completed has
zero effect on whether its links redirect — that remains entirely
governed by each link's own status.

## 8. Permissions

Every campaign endpoint requires `X-Workspace-Id` and goes through the
existing `WorkspaceRolesGuard` — VIEWER for read + analytics access,
MEMBER and above for full management, identical to the Links and
QrCodes RBAC pattern.

## 9. API usage

```
POST   /api/v1/campaigns
GET    /api/v1/campaigns                    (paginated, searchable, status-filterable)
GET    /api/v1/campaigns/:id
GET    /api/v1/campaigns/:id/links          (each with its QR codes)
GET    /api/v1/campaigns/:id/analytics      (overview, trend, top links/sources/mediums/countries, devices, referrers)
PATCH  /api/v1/campaigns/:id
DELETE /api/v1/campaigns/:id
POST   /api/v1/campaigns/:id/activate
POST   /api/v1/campaigns/:id/pause
POST   /api/v1/campaigns/:id/archive
```

Plus two workspace-wide additions to the existing analytics API for the
main dashboard (not campaign-scoped):

```
GET /api/v1/analytics/campaigns          (clicks broken out by campaign, "No campaign" included)
GET /api/v1/analytics/utm/:field         (field = source | medium | campaign | term | content)
```

Full request/response schemas are in Swagger at `/api/v1/docs`.

## 10. Performance notes

- Every campaign-analytics query uses database aggregation (`GROUP BY`,
  `count(*)`) — raw `ClickEvent` rows are never loaded into application
  memory.
- Indexes: `campaigns(workspaceId)`, `campaigns(status)`,
  `links(campaignId)`, plus the pre-existing `click_events` indexes
  (`workspaceId, occurredAt`, `linkId, occurredAt`) that every join here
  relies on.
- Redis caching is the existing `AnalyticsCacheService`, reused
  unmodified.
