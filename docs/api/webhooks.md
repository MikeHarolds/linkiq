# LinkIQ Webhooks API Guide

This guide is for developers who want LinkIQ to push events to their own
HTTP endpoint instead of polling. It covers endpoint management, the
event catalog, the delivery envelope, signature verification, replay
protection, retries, and delivery history. For the internal design (SSRF
protection, secret storage, retry engine), see
`docs/architecture/webhooks.md`. For everything else about the
developer API (base URL, API-key auth, pagination, errors), see
`docs/api/developer-guide.md`.

## Managing endpoints

All routes are nested under a workspace and require a session (JWT) or
an API key with the `webhooks:read`/`webhooks:write` scope. **Every
mutation requires an ADMIN or OWNER workspace role** — a webhook signing
secret is a credential, so this is deliberately stricter than Links/
Campaigns/Domains (where MEMBER can mutate). VIEWER (and any API key
with `webhooks:read`) can read endpoints and delivery history.

| Method   | Path                                                                 | Role    | Description                                                      |
| -------- | -------------------------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| `POST`   | `/workspaces/:workspaceId/webhooks`                                  | ADMIN+  | Create an endpoint. Returns the signing secret once.             |
| `GET`    | `/workspaces/:workspaceId/webhooks`                                  | VIEWER+ | List endpoints.                                                  |
| `GET`    | `/workspaces/:workspaceId/webhooks/:id`                              | VIEWER+ | Get one endpoint.                                                |
| `PATCH`  | `/workspaces/:workspaceId/webhooks/:id`                              | ADMIN+  | Update name/url/events.                                          |
| `DELETE` | `/workspaces/:workspaceId/webhooks/:id`                              | ADMIN+  | Soft-delete (history preserved).                                 |
| `POST`   | `/workspaces/:workspaceId/webhooks/:id/pause`                        | ADMIN+  | Stop deliveries without losing history.                          |
| `POST`   | `/workspaces/:workspaceId/webhooks/:id/activate`                     | ADMIN+  | Resume deliveries; resets the failure counter.                   |
| `POST`   | `/workspaces/:workspaceId/webhooks/:id/rotate-secret`                | ADMIN+  | Invalidate the old secret immediately; returns the new one once. |
| `POST`   | `/workspaces/:workspaceId/webhooks/:id/test`                         | ADMIN+  | Send a `webhook.test` event through the real pipeline.           |
| `GET`    | `/workspaces/:workspaceId/webhooks/:id/deliveries`                   | VIEWER+ | Paginated delivery history (`?page=&pageSize=&status=`).         |
| `GET`    | `/workspaces/:workspaceId/webhooks/:id/deliveries/:deliveryId`       | VIEWER+ | One delivery, including its event envelope.                      |
| `POST`   | `/workspaces/:workspaceId/webhooks/:id/deliveries/:deliveryId/retry` | ADMIN+  | Manually retry a `FAILED`/`EXHAUSTED` delivery.                  |

### Creating an endpoint

```bash
curl -X POST https://your-deployment/api/v1/workspaces/$WORKSPACE_ID/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production order pipeline",
    "url": "https://example.com/linkiq/webhook",
    "events": ["link.created", "link.clicked", "campaign.activated"]
  }'
```

```json
{
  "id": "9e2f...",
  "name": "Production order pipeline",
  "url": "https://example.com/linkiq/webhook",
  "secretPrefix": "whsec_ab12cd34",
  "secret": "whsec_ab12cd34ef56gh78ij90kl12mn34op56",
  "events": ["link.created", "link.clicked", "campaign.activated"],
  "status": "ACTIVE",
  "consecutiveFailures": 0,
  "lastDeliveryAt": null,
  "lastSuccessAt": null,
  "lastFailureAt": null,
  "createdAt": "2026-08-13T00:00:00.000Z",
  "updatedAt": "2026-08-13T00:00:00.000Z"
}
```

**`secret` is only ever present in the create and rotate-secret
responses.** Store it immediately — LinkIQ cannot show it to you again.
Every other read of this endpoint returns `secretPrefix` only.

Endpoint URLs must use HTTPS and must not resolve to a private, loopback,
or link-local address (this rejects internal services and cloud metadata
endpoints, not just literal `localhost`) — see
`docs/architecture/webhooks.md` §8 for the full SSRF-protection rules. A
local HTTP receiver is only permitted when the deployment explicitly
enables it for development (`WEBHOOK_ALLOW_HTTP_LOCALHOST=true`), and
even then only for URLs that resolve exclusively to loopback.

## Event catalog

Subscribe to any subset of these dotted event types when creating or
updating an endpoint — there is no "subscribe to everything" default.

| Resource       | Events                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Links          | `link.created`, `link.updated`, `link.deleted`, `link.paused`, `link.activated`, `link.archived`, `link.clicked`                  |
| QR Codes       | `qrcode.created`, `qrcode.updated`, `qrcode.deleted`                                                                              |
| Campaigns      | `campaign.created`, `campaign.updated`, `campaign.deleted`, `campaign.activated`, `campaign.paused`, `campaign.archived`          |
| Custom Domains | `domain.created`, `domain.verified`, `domain.activated`, `domain.disabled`, `domain.deleted`                                      |
| Billing        | `subscription.created`, `subscription.plan_changed`, `subscription.canceled`, `subscription.reactivated`, `billing.limit_reached` |
| API Keys       | `api_key.created`, `api_key.revoked`, `api_key.deleted`                                                                           |

`webhook.test` is sent only by the "send test event" action (below) and
is never a subscribable event type.

**Click privacy**: `link.clicked` payloads carry the same
already-privacy-filtered fields the analytics dashboard displays
(country/region/city, device/OS/browser, referrer domain/category,
bot flag, timestamp) — never the visitor's raw IP address (LinkIQ never
stores it) and never the internal visitor-correlation hash.

## The delivery envelope

Every delivery's request body is the exact same JSON for every endpoint
that receives a given event (signed once per event, not re-serialized
per delivery):

```json
{
  "id": "evt_9f8e7d6c5b4a3210",
  "type": "link.created",
  "createdAt": "2026-08-13T10:00:00.000Z",
  "workspaceId": "9e2f6c1a-...",
  "data": {
    "id": "3c7b1e9a-...",
    "shortCode": "abc1234",
    "publicUrl": "https://go.acme.com/abc1234",
    "destinationUrl": "https://acme.com/launch",
    "status": "ACTIVE"
  }
}
```

`id` is globally unique and immutable — every retry of this delivery
carries the identical `id`, which is exactly what makes receiver-side
deduplication possible (see Idempotency, below).

## Request headers

| Header                | Description                                               |
| --------------------- | --------------------------------------------------------- |
| `Content-Type`        | `application/json`                                        |
| `X-LinkIQ-Event-Id`   | Same as the envelope's `id` — use this to dedupe retries. |
| `X-LinkIQ-Event-Type` | Same as the envelope's `type`.                            |
| `X-LinkIQ-Timestamp`  | Unix seconds when this specific attempt was signed.       |
| `X-LinkIQ-Signature`  | `sha256=<hex>` — see Verifying signatures, below.         |

## Verifying signatures

Compute an HMAC-SHA256 over `"{timestamp}.{raw request body}"` using your
endpoint's signing secret, and compare it to `X-LinkIQ-Signature` with a
constant-time comparison:

```js
const crypto = require('crypto');

function verify(secret, timestamp, rawBody, signatureHeader) {
  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
```

Always verify against the **raw, unparsed** request body — re-serializing
a parsed JSON object can produce a byte-different string (key order,
whitespace) and fail verification even for a genuine request.

## Replay protection

Reject any request whose `X-LinkIQ-Timestamp` is further than **5
minutes** from your own clock, in either direction, in addition to
verifying the signature. LinkIQ signs the timestamp as part of the HMAC
input, so a captured request can't be replayed with a substitute
timestamp without invalidating the signature — the tolerance window is
what bounds how long a captured (but validly-signed, unexpired) request
stays replayable.

## Retries & delivery states

| Status       | Meaning                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `PENDING`    | Queued, not yet attempted.                                                                                            |
| `PROCESSING` | An attempt is in flight right now.                                                                                    |
| `DELIVERED`  | A 2xx response was received. Terminal.                                                                                |
| `FAILED`     | The most recent attempt failed but more automatic retries remain.                                                     |
| `EXHAUSTED`  | No more automatic retries — either every attempt failed, or the failure was permanent. Terminal until a manual retry. |

LinkIQ retries network errors, timeouts, and HTTP `408`/`429`/`5xx`
responses with exponential backoff, up to a configurable maximum attempt
count. Any other `4xx` response (e.g. `401`, `404`, `422`) is treated as
permanent and is **not** retried — fix the endpoint or its auth and use
manual retry instead.

An endpoint that reaches its configured consecutive-failure threshold is
**automatically disabled** — its delivery history is preserved, but no
new deliveries are attempted until you reactivate it (which also resets
the failure counter).

## Manual retry

```bash
curl -X POST \
  https://your-deployment/api/v1/workspaces/$WORKSPACE_ID/webhooks/$ENDPOINT_ID/deliveries/$DELIVERY_ID/retry \
  -H "Authorization: Bearer $TOKEN"
```

Creates exactly one new attempt on the **same** delivery — the event ID
and delivery ID never change, only `attemptCount` increments. Only valid
once automatic retries have already stopped (`FAILED` with none left, or
`EXHAUSTED`).

## Idempotency

Because every retry (automatic or manual) of a given delivery keeps the
same `X-LinkIQ-Event-Id`, the standard integration pattern is: record
processed event IDs on your side, and if a request arrives with an ID
you've already handled, return 2xx immediately without repeating the
side effect. **This is your responsibility as the receiver** — LinkIQ
guarantees it will never fabricate a second logical delivery for the
same endpoint+event, but it cannot guarantee your own success response
always makes it back to LinkIQ (a delivery can be retried even after you
successfully processed an earlier attempt, if that attempt's response
was lost or timed out in transit).

## Sending a test event

```bash
curl -X POST \
  https://your-deployment/api/v1/workspaces/$WORKSPACE_ID/webhooks/$ENDPOINT_ID/test \
  -H "Authorization: Bearer $TOKEN"
```

Sends one delivery through the exact same signing/delivery pipeline as a
real event, with `type: "webhook.test"` in the envelope — never
presented as a real domain event, and never counted against
`MAX_WEBHOOK_ENDPOINTS`/`MONTHLY_WEBHOOK_DELIVERIES` limits differently
than a real delivery would be.

## Billing

`MAX_WEBHOOK_ENDPOINTS` is enforced at creation time — you'll get a
`PLAN_LIMIT_REACHED` error if your workspace has reached its plan's
endpoint limit. `MONTHLY_WEBHOOK_DELIVERIES` is shown on your usage
dashboard but is never enforced — a real delivery is never dropped
because a soft counter ticked over.

## Security considerations for your receiver

- **Always verify the signature** — never trust an unsigned or
  incorrectly-signed request just because it arrived at your webhook URL.
- **Enforce the replay-tolerance window** described above.
- **Respond quickly** (LinkIQ's own delivery timeout is short) — do slow
  work asynchronously after acknowledging with a 2xx.
- **Never echo the signature or your secret back** in logs, error pages,
  or any response body.
- **Treat `data` as read-only, third-party input** — validate/sanitize
  before using it in a database query, shell command, or template.
