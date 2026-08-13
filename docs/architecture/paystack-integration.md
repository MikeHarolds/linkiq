# Paystack Integration (Sprint 10)

The first real `BillingProvider` implementation — see
[billing.md](./billing.md) for the domain model this plugs into
(`Plan`/`Subscription`/`BillingEvent`/`Invoice`, effective-status
derivation, usage enforcement, RBAC, audit logging). This document covers
everything specific to Paystack: the checkout flow, the inbound webhook
pipeline, the subscription state machine, and security.

`BILLING_PROVIDER=development` (the default) is completely unaffected —
every existing billing unit/e2e test passes unmodified with it, and none
of the code below ever runs.

## 1. Two unrelated webhook systems

**Do not confuse these** — they share only the general "HMAC-verify, then
process async" shape:

- **Sprint 9 — outbound**: LinkIQ → a workspace's own third-party
  integration (`WebhookEventsService.emit`, `webhook-deliveries` queue).
- **Sprint 10 — inbound**: Paystack → LinkIQ
  (`PaystackWebhookController`, `paystack-webhook-events` queue). A
  completely separate controller, queue, and processor — no code, tables,
  or queues are shared with Sprint 9.

They do interact at one point: a Paystack-driven state transition
(`PaystackWebhookProcessor`) calls the same `WebhookEventsService.emit()`
Sprint 7's `SubscriptionsService` already calls, so a workspace's own
outbound webhook subscribers see `subscription.*` events regardless of
what triggered the change.

## 2. Checkout flow (redirect-based / Paystack "Standard")

Chosen over inline/popup checkout — keeps LinkIQ entirely out of PCI
scope (no card field ever exists in LinkIQ's frontend) and reuses the
existing `billing-api.ts` request/response pattern with one additive
field (`checkoutUrl`).

```
User selects a plan (dashboard) or reactivates a canceled subscription
  → POST .../subscribe | .../change-plan  (unchanged request body: { planSlug })
  → SubscriptionsService: real-provider branch (only when NOT a trial
    plan) calls provider.createCheckoutSession({ workspaceId, planSlug, email })
  → PaystackBillingProvider.createCheckoutSession:
      - looks up Plan.providerPlanId — throws BadRequestException if the
        plan isn't configured for automated checkout (FREE/ENTERPRISE,
        or any plan with no Paystack plan_code set)
      - generates a unique reference (generatePaystackReference — hex,
        Paystack-charset-safe, see §10)
      - PaystackApiClient.initializeTransaction({ email, amountKobo:
        plan.priceAmount, reference, planCode: plan.providerPlanId,
        callbackUrl, metadata: { workspaceId, planSlug } })
      - returns { devFlow: false, checkoutUrl: authorization_url }
  → SubscriptionsService returns { subscription: <unchanged>, checkoutUrl }
    — the Subscription row is NOT touched yet; nothing is applied until
    the webhook (§9) confirms payment
  → frontend (dashboard/billing/page.tsx): window.location.href = checkoutUrl
  → user pays on Paystack's hosted page — LinkIQ never sees card data
  → Paystack redirects the browser to callbackUrl
    (APP_URL/dashboard/billing/callback?reference=...)
  → BillingCallback page calls GET .../billing/checkout/callback?reference=...
    → SubscriptionsService.verifyCheckout: PaystackBillingProvider
      .verifyTransaction(reference) — READ-ONLY, never mutates anything,
      even on success. Fast-path UX only.
  → Paystack also POSTs charge.success (+ subscription.create) to
    /webhooks/paystack — THIS is what actually activates the
    subscription (§9) — the source of truth
  → dashboard re-fetches (React Query invalidation) and reflects the
    confirmed state once the webhook lands (usually within seconds)
```

**Trials never reach any of this.** `SubscriptionsService.subscribe`
checks `plan.trialDays` first — a trialing subscription is applied
directly (LinkIQ-only, `TRIALING` status, real `trialEnd`), with zero
Paystack interaction, regardless of which provider is configured.
Paystack has no confirmed trial primitive to hand off to.

## 3. Upgrade / downgrade / reactivate — all route through a fresh checkout

No confirmed Paystack primitive exists for an in-place plan swap or
un-disabling a subscription (see §13 below), so all three follow the
identical mechanism as a first subscribe:

- **`changePlan`**: only when the existing subscription has a real,
  confirmed `providerSubscriptionId` does this route through
  `createCheckoutSession` instead of an in-place update — a
  `DevelopmentBillingProvider` subscription never has one, so this
  branch never triggers in dev mode.
- **`reactivate`**: `cancel()` already calls
  `provider.cancelSubscription` (Paystack `disableSubscription`)
  **immediately** when cancellation is requested — the Paystack
  subscription itself is disabled right away, even though `cancelAt` is
  scheduled for the end of the period (LinkIQ's own access continues
  until then). This means reactivating _after_ that has happened cannot
  be a silent DB-only undo — there's nothing left on Paystack's side to
  "un-disable." `reactivate()` therefore also routes through a fresh
  checkout whenever `providerSubscriptionId` is set.

`PaystackBillingProvider.changeSubscription()` always throws — it exists
only to satisfy the `BillingProvider` interface; `SubscriptionsService`'s
real-provider branch never calls it.

## 4. Payment identifiers — no dedicated columns added

`Subscription.providerSubscriptionId` is Paystack's `subscription_code`
**and** `email_token` packed together as `"<code>:<token>"`
(`packSubscriptionId`/`unpackSubscriptionId` in
`paystack-billing.provider.ts`) — both are required to call Paystack's
disable-subscription endpoint, and no dedicated column for the token was
added (the migration deliberately stays to four fields — see §5). Split
on the first `:`; neither component contains one.

`Subscription.providerPriceId` is reused to hold Paystack's `plan_code`
(no rename needed — the column was already generic).

## 5. Database changes (one migration, `20260813164406_add_paystack_billing`)

- **`Plan.providerPlanId String?`** — the Paystack `plan_code` for a
  purchasable plan (STARTER/PROFESSIONAL/BUSINESS only — see §12). Null
  for FREE/ENTERPRISE.
- **`Subscription.pastDueSince DateTime?`** — set when a recurring charge
  fails, cleared on the next successful charge. Lets `getEffectiveStatus`
  (billing.md §3) stay synchronous while deriving a `PAST_DUE → EXPIRED`
  transition after `PAYSTACK_PAST_DUE_GRACE_DAYS` (default 7).
- **`Invoice.failureReason String?`** — the provider's own failure
  message (`gateway_response`), surfaced to support/dashboard.
- **`InvoiceStatus` gains `REFUNDED`** — no prior value accurately
  represented a refunded invoice.

Additive only; every column nullable; no historical migration touched.

## 6. Plan mapping

| LinkIQ                                | Paystack                      | Notes                                                         |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| `Plan` (+ `providerPlanId`)           | Plan (`plan_code`)            | One per purchasable plan.                                     |
| `Subscription.providerCustomerId`     | Customer (`customer_code`)    | Stamped by the `charge.success` handler — see §9.             |
| `Subscription.providerSubscriptionId` | Subscription (packed, §4)     | Set only once `subscription.create` confirms it.              |
| `Invoice`                             | Transaction / recurring cycle | One row per successful or failed charge.                      |
| `BillingEvent`                        | any inbound webhook           | Idempotency ledger (billing.md §6), now with a live receiver. |

## 7. Payment amounts

Paystack requires amounts in the account's smallest currency unit
(kobo/cents), matching how `Plan.priceAmount` is already stored — no
conversion needed. **Currency and annual pricing are open product
decisions, not resolved here**: existing plans are priced in USD;
Paystack's native currency for a Nigeria-registered account is NGN (USD
addable alongside it for NG/KE accounts). No NGN figures have been
invented anywhere in this implementation.

## 8. Subscription state machine

| Transition                         | Trigger                                                                                     | Effect                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| (none) → `TRIALING`                | `subscribe()`, plan has `trialDays`                                                         | LinkIQ-only, zero Paystack calls.                                                                                           |
| (none)/pending → `ACTIVE`          | `charge.success` webhook                                                                    | Source of truth — see §9. Sets `providerCustomerId`, `currentPeriodStart`.                                                  |
| — → subscription confirmed         | `subscription.create` webhook                                                               | Fills in `providerSubscriptionId`/`providerPriceId`/`currentPeriodEnd`; emits `SUBSCRIPTION_CREATED`.                       |
| `ACTIVE` → `PAST_DUE`              | `invoice.payment_failed` webhook                                                            | `pastDueSince` set (only if not already set — preserves the original failure time across repeat failures).                  |
| `PAST_DUE` → `ACTIVE`              | User manually re-pays (fresh checkout — **Paystack never auto-retries**) → `charge.success` | `pastDueSince` cleared.                                                                                                     |
| `PAST_DUE` → `EXPIRED`             | Derived, read-time                                                                          | `pastDueSince` older than the grace window — see billing.md §3.                                                             |
| `ACTIVE` → pending-`CANCELED`      | `cancel()`                                                                                  | Unchanged from Sprint 7 — `cancelAt = currentPeriodEnd`; now also calls Paystack's disable-subscription immediately.        |
| provider-initiated disable         | `subscription.disable` webhook, `cancelAt` not already set                                  | Sets `cancelAt`/`canceledAt` to now — covers Paystack auto-disabling after repeated failures, which LinkIQ never asked for. |
| provider disable, LinkIQ-initiated | `subscription.disable` webhook, `cancelAt` already set                                      | No-op — this is just Paystack's confirmation echo of `cancel()`'s own call.                                                 |
| Upgrade/downgrade                  | Fresh checkout (§3)                                                                         | No proration; applied immediately once confirmed.                                                                           |

**Duplicate webhooks**: `BillingEvent`'s `@@unique([provider,
externalEventId])` — a re-delivered identical payload is a guaranteed
no-op (see §10 for how `externalEventId` is derived).

**Stale/out-of-order webhooks**: every transition that targets a specific
Paystack subscription (`subscription.create`, `subscription.disable`)
re-derives which LinkIQ `Subscription` row it applies to at the moment of
processing (via `metadata.workspaceId`, `providerCustomerId`, or a
`providerSubscriptionId` match) rather than trusting a job-payload
snapshot — an event for a subscription id no longer stored (superseded by
a later checkout) matches nothing and is silently ignored, never applied.
Provider state never blindly overwrites LinkIQ state: every transition
above is an explicit, named branch, never a generic "copy whatever
Paystack says" path.

## 9. Inbound webhook pipeline

```
Paystack
  → POST /webhooks/paystack  (PaystackWebhookController — public, no JWT)
  → raw body captured (NestFactory.create({ rawBody: true }) in main.ts;
    TestingModule.createNestApplication({ rawBody: true }) in e2e tests)
  → PaystackSignatureService: HMAC-SHA512(PAYSTACK_SECRET_KEY, TRUE raw
    bytes) compared, constant-time, against x-paystack-signature
  → invalid/missing → 401, nothing persisted
  → valid → BillingEventsService.recordEvent({ provider: 'paystack',
    externalEventId, eventType: body.event, payload: body })
  → respond 200 immediately (ack fast, per Paystack's own guidance)
  → if isNew: PaystackWebhookProducer enqueues { billingEventId } onto
    the paystack-webhook-events BullMQ queue (job payload is just the id
    — the processor reloads from Postgres, same convention as Sprint 9's
    webhook-deliveries queue)
  → PaystackWebhookProcessor (off the request path, concurrency 5):
      loads the BillingEvent → switches on eventType → applies the
      matching transition (§8) → AuditService.record(...) →
      WebhookEventsService.emit(...) where a matching outbound event type
      exists → BillingEventsService.markProcessed/markFailed
```

**Handled event types**: `charge.success`, `subscription.create`,
`subscription.disable`, `invoice.payment_failed`. Every other event type
Paystack sends (`invoice.create`/`.update`, `refund.*`,
`charge.dispute.*`, `subscription.not_renew`, etc.) is recorded via
`BillingEventsService` (so the raw payload is never lost) but has no
state-transition handler — logged at debug level, marked `PROCESSED`, no
further action. This is a documented simplification, not a silent gap:
disputes/refunds are recorded only, not automated, this sprint.

**A handler failure marks the `BillingEvent` `FAILED`, never rethrown for
BullMQ to retry.** Unlike Sprint 9's outbound HTTP deliveries (where a
timeout is legitimately worth retrying), a correlation or data-shape
failure here won't be fixed by trying again — the failure is durably
recorded on the `BillingEvent` row for ops follow-up instead.

## 10. Security

- **Signature verification**: HMAC-SHA512 over the **true raw request
  bytes**, constant-time compare (`crypto.timingSafeEqual`) —
  `PaystackSignatureService`. Deliberately does NOT copy Paystack's own
  simplified example of re-`JSON.stringify`-ing the _parsed_ body, which
  isn't guaranteed byte-identical to what was actually sent.
- **No separate webhook secret.** Unlike Stripe or LinkIQ's own outbound
  webhooks, Paystack signs with the same `PAYSTACK_SECRET_KEY` used for
  outbound API calls — the old (always-blank, unused) Sprint 7
  `BILLING_WEBHOOK_SECRET` placeholder has been retired.
- **Idempotency key derivation.** Paystack does not confirm a
  wrapper-level unique event id in every payload. `externalEventId` is
  `sha256(raw request bytes)` — a byte-identical redelivery (Paystack's
  own retry-on-missed-ack behavior) hashes the same and is correctly
  deduped; any genuinely different event, even for the same underlying
  resource, hashes differently and is correctly processed. This
  deliberately avoids relying on `data.id`, which stays constant across a
  resource's own state transitions (e.g. successive `invoice.update`
  events) and would otherwise wrongly collide.
- **Reference generation** (`generatePaystackReference`): `txn-` +
  64 hex characters (`common/utils/token.ts`'s `generateOpaqueToken`,
  already pure hex) — Paystack restricts references to alphanumeric plus
  `-`, `.`, `=` (notably **not** `_`), so a dedicated generator is used
  rather than the base64url tokens used elsewhere in this codebase.
- **Correlation is an approximation, not a cryptographic guarantee** —
  see §9's "stale/out-of-order" note and §8's table. `charge.success` is
  the most trustworthy signal (LinkIQ set `metadata.workspaceId` itself
  at `initializeTransaction` time); events without confirmed metadata
  fall back to matching on `providerCustomerId`, which is unique per
  Paystack customer but not verified to be unique per LinkIQ workspace if
  the same email is reused across workspaces — a known, documented edge
  case, not silently assumed away.
- **No card data ever reaches LinkIQ** — redirect-based checkout means
  LinkIQ's frontend never collects a card field; Paystack is the only
  system in PCI scope.
- **Logging**: `PaystackApiClient` never logs its request body or
  Authorization header, even on failure — only the HTTP status and
  Paystack's own `message` field.
- **Audit actions**: `billing.checkout_initiated`,
  `billing.payment_succeeded`, `billing.payment_failed`,
  `billing.subscription_activated`, `billing.subscription_disabled` —
  same `action: 'billing.*'` convention as Sprint 7, never including the
  secret key or raw payload in `metadata`.

## 11. Frontend

- `billing-api.ts`: `subscribe`/`changePlan`/`reactivateSubscription`
  return `SubscriptionMutationResultDto` (`SubscriptionDto` +
  `checkoutUrl: string | null`); a new `verifyCheckout(workspaceId,
reference)` call.
- `/dashboard/billing/page.tsx`: when a response includes a non-null
  `checkoutUrl`, the browser does a full redirect
  (`window.location.href`) instead of invalidating queries.
- `/dashboard/billing/callback/page.tsx` (new): reads `?reference=` from
  the URL, calls `verifyCheckout`, shows a verifying/success/pending/
  failed state, links back to `/dashboard/billing`. Read-only — never
  activates anything itself.

## 12. What's purchasable via automated checkout

Only **STARTER, PROFESSIONAL, BUSINESS** — `PaystackBillingProvider
.createCheckoutSession` throws `BadRequestException` for any plan with no
`Plan.providerPlanId` set, which is FREE and ENTERPRISE by design (both
already have `priceAmount: 0`, and ENTERPRISE is "contract pricing," not
an automated-checkout candidate). `Plan.providerPlanId` values themselves
are a one-time manual/ops step (`PaystackApiClient.createPlan`), blocked
on the currency decision in §7 — not created by any code path in this
sprint.

## 13. Known limitations

- **No confirmed native proration/plan-swap primitive** — every upgrade/
  downgrade is a fresh checkout, no partial-period credit (§3).
- **No confirmed subscription re-enable endpoint** — reactivating after
  the underlying Paystack subscription is already disabled requires a
  fresh checkout, not a silent undo (§3).
- **Whether `transaction/initialize` implicitly creates a Paystack
  customer from just an email** was not confirmed by this sprint's
  research — `PaystackApiClient.createCustomer` exists but is not
  currently called by `createCheckoutSession`, which relies on
  Paystack's own implicit resolution. Flagged, not silently assumed.
- **Correlation approximation** — see §10's note on `providerCustomerId`
  matching across workspaces sharing an email.
- **Currency/annual pricing** are open product decisions (§7).
- **Disputes and refunds are recorded only**, not automated (§9).
- **No local tunneling set up** for live inbound-webhook testing during
  development — not required for the automated test suite (§14), and
  intentionally not configured without separate approval.

## 14. Test strategy

- **Unit**: `PaystackApiClient` (mocked `fetch`, no real network),
  `PaystackSignatureService`, `generatePaystackReference`,
  `PaystackBillingProvider`, `PaystackWebhookProcessor` (one test per
  handled event type, plus duplicate/stale/unrecognized-event cases),
  `SubscriptionsService`'s checkout-branching, `getEffectiveStatus`'s
  `PAST_DUE → EXPIRED` branch.
- **E2E** (`test/paystack-webhooks.e2e-spec.ts`): posts synthetic
  Paystack-shaped payloads with a correctly computed HMAC-SHA512
  signature (a fixed test secret, set via `process.env.PAYSTACK_SECRET_KEY`
  before the test app compiles) directly at `/webhooks/paystack`, and
  polls for the resulting DB state — **no real Paystack network call
  anywhere in the automated suite.** Covers: signature rejection
  (missing/wrong-secret/tampered-body), `charge.success` activation +
  invoice recording, exact-redelivery idempotency, unresolvable-metadata
  failure handling, `subscription.create` correlation, `subscription
.disable`'s LinkIQ-initiated-vs-provider-initiated branching, `invoice
.payment_failed` → `PAST_DUE`, and unrecognized-event no-ops.
- **Manual, optional**: a smoke test against Paystack's real test-mode
  sandbox is deliberately separate from CI and never required for the
  suite to pass.

## 15. Deployment / rollout order

1. Deploy the migration + webhook receiver with `BILLING_PROVIDER` still
   `development` — no behavior change for existing traffic.
2. Register the production webhook URL
   (`https://<api-host>/api/v1/webhooks/paystack`) in the Paystack
   dashboard — manual, one-time, outside code. `infrastructure/nginx/
linkiq.conf`'s standard `proxy_pass` needs no changes — a stock
   reverse proxy passes body bytes through unmodified, which is all raw-
   body signature verification needs.
3. Only then flip `BILLING_PROVIDER=paystack`.

## 16. Environment variables

```
PAYSTACK_SECRET_KEY=            # server-only; also verifies inbound webhook signatures
PAYSTACK_PUBLIC_KEY=            # safe client-exposed; unused server-side by this sprint's redirect-based checkout
PAYSTACK_PAST_DUE_GRACE_DAYS=7  # how long PAST_DUE may persist before getEffectiveStatus derives EXPIRED
```

Test vs. live mode is inferred from the key's own prefix
(`sk_test_`/`sk_live_`), not a separate flag. `BILLING_WEBHOOK_SECRET`
(Sprint 7, always blank, never used) has been removed — Paystack has no
separate webhook-signing secret.
