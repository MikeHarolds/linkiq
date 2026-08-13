# Webhooks & Event Delivery Architecture

Sprint 9 adds outbound webhooks: workspace-scoped endpoints that receive
signed HTTP POSTs whenever a subscribed event happens inside LinkIQ (a
link created, a campaign activated, a click recorded, a subscription
changed, ...). Delivery is fully asynchronous — nothing on a redirect,
link/campaign/QR/domain/billing mutation, or API response path ever
waits on an outbound HTTP call. This document explains the pipeline, the
security model, and the operational states a delivery moves through.

## 1. Pipeline overview

```
LinkIQ mutation commits
  -> WebhookEventsService.emit(type, workspaceId, resourceId, data)
       -> writes one immutable WebhookEvent row
       -> finds ACTIVE endpoints subscribed to this event type
       -> writes one WebhookDelivery row per matching endpoint (PENDING)
       -> enqueues one BullMQ job per delivery ({ deliveryId } only)
  -> WebhookDeliveryProcessor (worker, off the request path)
       -> loads delivery + endpoint + event fresh from Postgres
       -> re-validates the URL against the SSRF guard
       -> signs the envelope, POSTs it with a bounded timeout
       -> classifies the outcome, updates the delivery row
       -> retries (BullMQ-native backoff) or exhausts
```

`emit()` never performs HTTP — it only writes to Postgres and enqueues.
The only place an outbound HTTP request happens is
`WebhookDeliveryProcessor`, reusing the same `QueueModule`/BullMQ
connection every other async pipeline in this codebase already uses
(`ClickEventProcessor`, `ApiUsageProcessor`) — no second queue system.

## 2. Event vs. delivery

An **event** (`WebhookEvent`) is one immutable record of "this thing
happened" — created once, with a globally unique, immutable ID
(`evt_<random>`). A **delivery** (`WebhookDelivery`) is one endpoint's
attempt to receive that event. If three endpoints in a workspace
subscribe to `link.created`, one `link.created` happens, one
`WebhookEvent` row is created, and three `WebhookDelivery` rows fan out
from it — the payload is never duplicated per endpoint, and every retry
of a given delivery keeps the same event ID (idempotency, see §7). A
unique constraint on `(webhookEndpointId, eventId)` makes a second
logical delivery for the same endpoint+event impossible even under a
concurrent retry race.

## 3. Database model

```
WebhookEndpoint
  id, workspaceId, name, url
  secretPrefix      (safe to display, e.g. "whsec_ab12cd34")
  secretCiphertext  (AES-256-GCM ciphertext — see §5, never a hash)
  events            WebhookEventType[]  (§4)
  status            ACTIVE | PAUSED | DISABLED
  consecutiveFailures (drives auto-disable, §9)
  lastDeliveryAt, lastSuccessAt, lastFailureAt
  createdById (SetNull on user deletion)
  deletedAt   (soft delete — preserves delivery history)

WebhookEvent
  id ("evt_...", application-generated), workspaceId, type, resourceId, payload, createdAt

WebhookDelivery
  id, webhookEndpointId, eventId, eventType
  attemptCount, status (PENDING|PROCESSING|DELIVERED|FAILED|EXHAUSTED)
  responseStatus, responseTimeMs
  lastAttemptAt, nextAttemptAt, deliveredAt, failureReason
  @@unique([webhookEndpointId, eventId])
```

`Workspace` gains `webhookEndpoints[]`/`webhookEvents[]`, both
`onDelete: Cascade` — deleting a workspace can never leave an orphaned
credential or history behind. `PlanLimitKey` gains
`MAX_WEBHOOK_ENDPOINTS` (enforced, §10) and `MONTHLY_WEBHOOK_DELIVERIES`
(informational only, §10). Migrations: `add_webhooks` and a follow-up
`webhook_secret_use_encryption` (renamed `secretHash` to
`secretCiphertext` before any row existed — see §5 for why) — no
historical migration was modified.

## 4. Event catalog

`modules/webhooks/event-catalog.ts` is the single source of truth
mapping Prisma's SCREAMING_SNAKE `WebhookEventType` enum values to the
dotted wire strings every payload and subscription actually uses (a
Prisma enum can't contain dots, but `WebhookEndpoint.events` needs to
stay a real, indexable Postgres array — the same shape Sprint 8's
`ApiKeyPermission[]` already established).

| Category  | Wire event types                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Links     | `link.created`, `link.updated`, `link.deleted`, `link.paused`, `link.activated`, `link.archived`, `link.clicked`                  |
| QR Codes  | `qrcode.created`, `qrcode.updated`, `qrcode.deleted`                                                                              |
| Campaigns | `campaign.created`, `campaign.updated`, `campaign.deleted`, `campaign.activated`, `campaign.paused`, `campaign.archived`          |
| Domains   | `domain.created`, `domain.verified`, `domain.activated`, `domain.disabled`, `domain.deleted`                                      |
| Billing   | `subscription.created`, `subscription.plan_changed`, `subscription.canceled`, `subscription.reactivated`, `billing.limit_reached` |
| API Keys  | `api_key.created`, `api_key.revoked`, `api_key.deleted`                                                                           |
| Test only | `webhook.test` — never subscribable, only ever sent by the "send test event" action (§11)                                         |

Every event represents an **actual, already-committed** domain state
change — the emit call sits in the exact place `AuditService.record(...)`
already sits in every service, immediately after a mutation succeeds,
never merely because an endpoint was called. `domain.verify`, for
example, only emits `domain.verified` on the branch where verification
actually succeeded — never on `domain.verification_failed`.

`link.clicked` is the one deliberate exception to "emit from the mutating
service": it's emitted from `ClickEventProcessor.process()` (the existing
Sprint 3 async click-processing worker), **after** its own transaction
commits, and skipped entirely on the idempotent-retry branch (a retried
click job must not emit a second `link.clicked`). This keeps click-event
emission fully off the redirect hot path — `RedirectService` has no
dependency on webhooks at all — and reuses click ingestion instead of
duplicating it.

## 5. Secret generation & why it's encrypted, not hashed

`common/utils/webhook-secret.ts` generates
`whsec_<192 bits of random, URL-safe data>` — the same
`randomBytes`-based approach as every other LinkIQ secret (API keys,
opaque tokens), never a UUID or timestamp.

Every other secret in this codebase (API keys, refresh tokens) is stored
as a **one-way hash**, because the server only ever needs to _verify_ a
caller-supplied value against it. A webhook secret is different: LinkIQ
itself must reuse the raw secret, repeatedly, forever, to HMAC-sign every
future outbound delivery — a one-way hash cannot support that. So
`WebhookEndpoint.secretCiphertext` stores **AES-256-GCM ciphertext**
instead (`security/webhook-secret-cipher.service.ts`), decryptable only
with a server-held key (`WEBHOOK_SECRET_ENCRYPTION_KEY`) that never
leaves the API process. The key itself is derived via SHA-256 of the
configured env value (any string length reduced to exactly 32 bytes),
the same "arbitrary env string -> fixed-size cryptographic material"
shape `VISITOR_HASH_SALT` already uses elsewhere in this codebase, just
for encryption instead of hashing. This is the codebase's first use of
reversible (symmetric) encryption — every prior secret only ever needed
one-way hashing.

The raw secret is returned in the API response **exactly once** — on
creation and on rotation — and never again: not in `GET` responses, not
in logs, not in audit metadata (only `secretPrefix` is ever recorded).

## 6. Signing

`WebhookSignatureService.sign(secret, timestamp, rawBody)` computes:

```
signature = "sha256=" + HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
```

using Node's built-in `crypto.createHmac` — no invented cryptography.
Every delivery request carries:

| Header                | Meaning                                                             |
| --------------------- | ------------------------------------------------------------------- |
| `X-LinkIQ-Event-Id`   | The event's immutable ID (`evt_...`) — identical across every retry |
| `X-LinkIQ-Event-Type` | The dotted wire event type, e.g. `link.created`                     |
| `X-LinkIQ-Timestamp`  | Unix seconds when this attempt was signed                           |
| `X-LinkIQ-Signature`  | `sha256=<hex hmac>` over `${timestamp}.${rawBody}`                  |

**Verifying on the receiving end** (recommended, pseudocode):

```
expected = "sha256=" + hmacSha256Hex(secret, `${timestamp}.${rawBody}`)
if (!timingSafeEqual(expected, receivedSignature)) reject()
if (Math.abs(now() - timestamp) > toleranceSeconds) reject()  // replay protection
```

## 7. Replay protection & idempotency

The timestamp is part of the signed material, so a captured
request/signature pair cannot be replayed with a different timestamp
without invalidating the signature, and a receiver that also enforces a
tolerance window (this codebase recommends **5 minutes**, matching the
DNS-resolution timeout's order of magnitude and typical clock-drift
tolerances) rejects stale replays outright. LinkIQ does not enforce a
receiver-side tolerance itself — that check belongs to the receiver,
documented explicitly in `docs/api/webhooks.md`.

Idempotency: a retry of the same logical delivery reuses the exact same
`eventId` and `deliveryId` — only `attemptCount` increments. LinkIQ
guarantees it will never create a second logical delivery for the same
endpoint+event, but **receiver-side idempotency remains the receiver's
own responsibility** (e.g. dedupe on `X-LinkIQ-Event-Id`) — a delivery
can still, in principle, succeed on LinkIQ's side after a receiver
already processed an earlier attempt whose success response never made
it back (a `deliveredAt` classified as “failed” by a truncated response).

## 8. SSRF protection

Webhook URLs are entirely user-controlled — without protection, LinkIQ's
own delivery workers would be a ready-made SSRF proxy able to reach
internal services, other containers, and cloud metadata endpoints on an
attacker's behalf. `security/webhook-url-guard.ts` (`WebhookUrlGuard`) is
called **twice**: at endpoint create/update time (fast rejection, good
UX) and again immediately before every delivery attempt inside the
worker (defense against DNS-rebinding/TOCTOU — a hostname's DNS can
change between when an endpoint was saved and when it's actually
delivered to).

It never trusts a hostname string alone:

1. Parse the URL; reject anything that isn't `http:`/`https:`.
2. Any hostname that isn't already a literal IP is resolved via
   `dns.promises.lookup(hostname, { all: true })` (with a 5s timeout,
   failing closed to "unresolvable" on timeout/error) — the _resolved_
   address is what gets classified, so non-canonical IPv4 literals
   (`127.1`, hex/octal forms) are caught too, since the WHATWG URL parser
   already canonicalizes those into a literal `net.isIP` recognizes.
3. Every resolved address is classified and rejected if it's: loopback
   (`127.0.0.0/8`, `::1`), private (`10/8`, `172.16/12`, `192.168/16`,
   plus `100.64.0.0/10` carrier-grade NAT), link-local (`169.254.0.0/16`
   — this is also where cloud metadata endpoints like `169.254.169.254`
   live, so no separate metadata-IP list is needed; `fe80::/10` for
   IPv6), unique-local IPv6 (`fc00::/7`), unspecified (`0.0.0.0`, `::`),
   or an IPv4-mapped IPv6 address wrapping any of the above
   (`::ffff:127.0.0.1` is unwrapped and re-checked against the IPv4
   rules). If **any** resolved address is unsafe, the whole URL is
   rejected — a hostname that resolves to both a public and a private
   address does not get a pass.
4. HTTPS is required in every environment by default. The single,
   narrow exception (`WEBHOOK_ALLOW_HTTP_LOCALHOST=true`, off by
   default) permits `http://` **only** when every resolved address is
   loopback — every other private/reserved range stays blocked
   regardless of this flag, in every environment. This is what lets a
   developer point at `http://localhost:PORT` locally, and what this
   sprint's own e2e suite uses for its local test receiver, without
   weakening SSRF protection for anything else.

**Known residual risk**: the guard re-resolves DNS at delivery time but
does not pin the resolved IP across the connect phase of that same
attempt (no custom `dns.lookup`-injecting HTTP agent). A sufficiently
well-timed DNS rebind between the check and the actual TCP connect is a
known, accepted residual risk of this approach — documented here
explicitly rather than silently left unaddressed, and out of scope for
this sprint.

## 9. Delivery worker: retries, backoff, exhaustion, auto-disable

`WebhookDeliveryProcessor` reuses BullMQ's own `attempts`/`backoff`
engine (configured at enqueue time from `WEBHOOK_MAX_ATTEMPTS` /
`WEBHOOK_BACKOFF_BASE_MS`) rather than hand-rolling a scheduler — the
same pattern `ClickEventProducer` already established.

On each attempt:

- 2xx -> `DELIVERED`; `consecutiveFailures` resets to 0.
- Network error or timeout (`WEBHOOK_TIMEOUT_MS`, via `AbortController`)
  -> **retryable**.
- HTTP 408, 429, or any 5xx -> **retryable**.
- Any other 4xx -> **permanent** (never retried).

A retryable failure with attempts remaining leaves the delivery `FAILED`
and rethrows, letting BullMQ schedule the next attempt per its
configured exponential backoff. A retryable failure on the final
configured attempt, or any permanent failure, moves the delivery to
`EXHAUSTED` and does **not** rethrow — no further automatic retry.

Whenever a delivery reaches a terminal failure (`EXHAUSTED`), the
endpoint's `consecutiveFailures` counter increments exactly once — per
terminal _delivery_, not per retry attempt, so one flaky event's several
retries don't themselves look like several consecutive failures. Once
that counter reaches `WEBHOOK_AUTO_DISABLE_THRESHOLD`, the endpoint is
automatically set to `DISABLED`, audited (`webhook.disabled`), and stops
receiving future deliveries — its delivery history is preserved.
Reactivating an endpoint (manually, after pause or auto-disable) resets
`consecutiveFailures` to 0.

Manual retry (`POST .../deliveries/:id/retry`) enqueues a **new** BullMQ
job with `attempts: 1` — one explicit attempt, not a fresh automatic
retry cascade — referencing the same `deliveryId`; `attemptCount` keeps
incrementing on the same row and the event ID never changes.

## 10. Billing integration

`MAX_WEBHOOK_ENDPOINTS` is enforced at creation via the same
`BillingUsageService.assertCanUse(...)` pattern every other Sprint 7
creation limit uses. `MONTHLY_WEBHOOK_DELIVERIES` is tracked (counting
`WebhookDelivery` rows created in the current billing period) and shown
on the usage dashboard, but **never enforced** — the same
informational-only treatment `MONTHLY_CLICKS` already gets. Silently
dropping a real webhook delivery because a soft counter ticked over
would contradict the point of a production-ready delivery system far
more than an uncapped metric would.

## 11. Test events

`POST .../webhooks/:id/test` sends a `webhook.test` event to exactly
that endpoint, through the identical signing/delivery infrastructure as
a real event (same envelope shape, same signature scheme) — but it
bypasses the normal event-type subscription matching in
`WebhookEventsService.emit()`, since `WEBHOOK_TEST` is never a
subscribable event, and is clearly identifiable to the receiver via
`type: "webhook.test"` so it's never mistaken for a real domain event.

## 12. Authorization

Every mutation (create/update/delete/pause/activate/rotate-secret/test/
manual-retry) requires `ADMIN` or `OWNER` — unlike Links/Campaigns/
Domains (where `MEMBER` can mutate), a webhook signing secret is a
credential, matching Sprint 7/8's precedent that credential management
(billing, API keys) is `ADMIN`+ only. `VIEWER` can read endpoints and
delivery history. API keys can manage webhooks too, gated by the new
`WEBHOOKS_READ`/`WEBHOOKS_WRITE` `ApiKeyPermission` values, applied
alongside `@Roles(...)` on every route exactly like every Sprint 8
controller — no separate auth mechanism.

## 13. Audit logging

`webhook.created`, `.updated`, `.paused`, `.activated`, `.deleted`,
`.secret_rotated`, `.delivery_failed` (once per terminal failure, not
per retry attempt), `.disabled`, `.manual_retry` — never the secret,
never a request's `Authorization`-equivalent data, matching Sprint 8's
identical guarantee for API keys.
