# Paystack Integration (Sprint 10, invoice-first checkout since Sprint 18A, amount/currency-authoritative checkout since Sprint 18B)

The first real `BillingProvider` implementation — see
[billing.md](./billing.md) for the domain model this plugs into
(`Plan`/`Subscription`/`BillingEvent`/`Invoice`, effective-status
derivation, usage enforcement, RBAC, audit logging). This document covers
everything specific to Paystack: the invoice-first checkout flow, the
inbound webhook pipeline, the subscription state machine, and security.

**Sprint 18A superseded Sprint 10's checkout flow.** Sprint 10 shipped a
one-step flow — selecting a plan called `createCheckoutSession`
immediately and redirected the browser, with the inbound webhook as the
sole source of truth for activation and the checkout-callback route
explicitly documented as "read-only, never activates anything." Sprint
18A replaced that with an explicit two-step, invoice-first flow: plan
selection creates a reviewable `PENDING` invoice with **no** Paystack
transaction yet; a separate "Proceed to Payment" action initializes the
real transaction; and the checkout-callback route is no longer read-only
— it independently re-verifies the transaction server-side and activates
the subscription itself, through the exact same idempotent function the
webhook calls. Every section below describes the current (Sprint 18A)
behavior; nothing in this document describes the superseded Sprint 10
flow.

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

## 2. Checkout flow (redirect-based / Paystack "Standard", invoice-first since Sprint 18A)

Chosen over inline/popup checkout — keeps LinkIQ entirely out of PCI
scope (no card field ever exists in LinkIQ's frontend). Invoice-first
means plan selection and payment initialization are two separate,
explicit steps — the `Invoice` row (see billing.md §7) is the reviewable
artifact in between.

```
User selects a plan (dashboard)
  → POST .../subscribe | .../change-plan  (unchanged request body: { planSlug, currency? })
  → SubscriptionsService.determinePaymentRequirement decides whether
    payment is required (billing.md §5a) — downgrades/lateral moves/
    first-ever trials NEVER reach any of the steps below; they still
    apply directly, exactly as Sprint 17 always did (see §3's downgrade
    note)
  → requiresPayment && a real provider is configured:
      - InvoicesService.createOrReusePendingInvoice({ workspaceId,
        subscriptionId, targetPlanId, amount, currency, provider }) —
        creates a PENDING invoice, or reuses an already-PENDING one for
        the same workspace+targetPlan (refreshing its amount/currency to
        the latest resolved values — safe, since nothing has been
        charged yet)
      - NO Paystack call happens here. Nothing about the Subscription
        row changes.
  → API responds { subscription: <unchanged>, checkoutUrl: null,
    invoice: {...PENDING...} }
  → frontend: PlanChangeConfirmDialog (the pre-existing Sprint 17
    preview) is followed by InvoiceReviewDialog — invoice number, target
    plan, billing period, due date, total, payment gateway, and an
    explicit "you're still on the {current} plan" note. The user is
    never told they're upgraded here.

User clicks "Proceed to Payment"
  → POST .../invoices/:invoiceId/pay  (no body — the invoice's OWN
    stored currency/amount is used; a request-supplied currency is never
    accepted, see §7/currency.md)
  → SubscriptionsService.proceedToPayment:
      - loads the PENDING invoice, scoped to the calling workspace
      - PaystackApiClient.initializeTransaction({ email, amountKobo:
        invoice.amount, currency: invoice.currency, reference:
        <generated>, callbackUrl, metadata: { workspaceId, planSlug,
        currency, invoiceId } }) — metadata.invoiceId is new in Sprint
        18A, see §8's correlation note. Since Sprint 18B (§7a), no
        `plan` field is ever sent — the invoice's own amount/currency
        are the only source of truth for what Paystack charges
      - InvoicesService.attachProviderReference(invoice.id, reference) —
        the invoice is still PENDING; only providerInvoiceId changes
  → API responds { checkoutUrl: authorization_url }
  → frontend: window.location.href = checkoutUrl
  → user pays on Paystack's hosted page — LinkIQ never sees card data
  → Paystack redirects the browser to callbackUrl
    (APP_URL/dashboard/billing/callback?reference=...)

Callback (no longer read-only — see §2a/§9)
  → BillingCallback page calls GET .../billing/checkout/callback?reference=...
  → BillingController.checkoutCallback:
      - provider.verifyTransaction(reference) — an independent,
        server-side call to Paystack; the query-string reference alone
        is NEVER trusted as proof of anything
      - SubscriptionsService.confirmAndActivate(...) — the SAME shared,
        idempotent function the inbound webhook calls (§8/§9) — verifies
        and, only on success, activates
  → API responds { success, invoice: {...PAID or FAILED...}, subscription }
  → Paystack also POSTs charge.success to /webhooks/paystack — calls the
    identical confirmAndActivate; whichever of the callback/webhook fires
    first performs the real transition, the other is a guaranteed no-op
    (§2a)
  → dashboard re-fetches (React Query invalidation) and reflects the
    confirmed state
```

**Trials never reach any of this.** `SubscriptionsService.subscribe`
checks `plan.trialDays` first — a trialing subscription is applied
directly (LinkIQ-only, `TRIALING` status, real `trialEnd`), with zero
Paystack interaction and no invoice created at all, regardless of which
provider is configured. Paystack has no confirmed trial primitive to
hand off to.

## 2a. Server-side verification, invoice states, retry, and idempotency (Sprint 18A)

**`SubscriptionsService.confirmAndActivate`** is the single point every
successful-or-failed payment outcome flows through — called from both
`BillingController.checkoutCallback` and
`PaystackWebhookProcessor.handleChargeSuccess`. Its checklist, in order:

1. **Correlate** the reference to a LinkIQ `Invoice` — first by
   `InvoicesService.findByProviderReference(provider, reference)` (set
   by `proceedToPayment`'s `attachProviderReference`); if that misses,
   fall back to `metadata.invoiceId` (present when the webhook races
   ahead of the callback's own attach call). No correlated invoice at
   all (a transaction that never went through the invoice-first flow —
   see §8's legacy-fallback note) means neither route touches anything
   here; the caller falls back to its own handling.
2. **Idempotency short-circuit** — if the correlated invoice is already
   `PAID` or `FAILED`, return immediately. No re-verification, no
   re-audit, no re-role-sync, no re-activation. This is what makes a
   duplicate callback call and a duplicate webhook delivery both
   guaranteed no-ops, regardless of which arrives second.
3. **Verify**, only for a still-`PENDING` invoice:
   - the provider's own reported status is `"success"`;
   - **amount** matches the invoice's own stored `amount` exactly;
   - **currency** matches the invoice's own stored `currency` exactly (a
     provider response with no currency at all is treated as
     non-conflicting, since not every caller can supply one — but a
     provider currency that IS present and differs is always rejected);
   - **workspace** — where the transaction metadata carries a
     `workspaceId`, it must match the invoice's own `workspaceId`.

   Any failure here marks the invoice `FAILED` (with a reason —
   "Paystack reported status …" or "amount/currency/workspace did not
   match the invoice") and returns without activating anything. A
   tampered or mismatched value is rejected, never silently trusted.

4. **Activate**, only once every check above passes: updates the
   `Subscription` (plan, `ACTIVE`, `providerCustomerId`, period dates,
   the invoice's own `currency`/`amount` — never re-derived from the
   plan's live price), marks the invoice `PAID` with `paidAt`, records
   `billing.payment_succeeded`, emits `SUBSCRIPTION_CREATED` (first-ever
   paid conversion, i.e. the workspace's previous amount was 0) or
   `SUBSCRIPTION_PLAN_CHANGED` (any other paid transition), and
   re-resolves every workspace OWNER's role (Sprint 15 — including
   preserving an existing `ADMIN_ASSIGNED` override, since
   `RoleResolutionService.syncStoredRole` already guarantees that
   independent of who calls it).

**Invoice states** (see billing.md §7 for the full lifecycle): `PENDING`
→ `PAID` or `PENDING` → `FAILED`, both terminal. A `FAILED` invoice is
never resurrected to `PAID` — LinkIQ's financial history stays accurate
even if a stale/replayed success signal shows up later.

**Retry** applies only to a still-`PENDING` invoice — re-invoking
`proceedToPayment` against the SAME invoice starts a fresh Paystack
transaction and overwrites the previous (abandoned) reference; the
invoice's own identity, number, and history are preserved. A `FAILED`
invoice cannot be retried directly — a fresh plan selection creates a
new `PENDING` invoice instead (§7's terminal-state rationale).

**Abandoned payment**: if the user never completes checkout, neither the
callback nor a webhook ever fires — the invoice simply stays `PENDING`,
unchanged, indefinitely (no auto-expiry — see §13).

## 2b. Admin visibility (Sprint 18A)

`GET /admin/invoices` and `GET /admin/invoices/:id` (Sprint 11,
`AdminInvoicesController`) return the raw `Invoice` row plus its
`workspace` and — since Sprint 18A — its `targetPlan` (`{ id, name,
slug }`, via `InvoicesService.listAllForAdmin`'s `targetPlan` include).
An operator can see, per invoice: number, status (including the new
`PENDING`/`FAILED` values — `QueryInvoicesDto.status` already accepts
them via `@IsEnum(InvoiceStatus)`), provider, `providerInvoiceId` (the
Paystack transaction reference), amount, currency, workspace, target
plan, `issueDate`, `paidAt`, and `failureReason`. **Paystack secret
credentials are never exposed anywhere in this response** — nothing in
the `Invoice` model or its relations stores `PAYSTACK_SECRET_KEY` or any
derivative of it; the admin settings page's own "test connection" check
(`admin-settings.service.ts`) is the only place that ever touches the
key, and it never echoes it back. The admin frontend (`/admin/invoices`)
surfaces a Plan column and `Pending`/`Failed` status filters alongside
the existing ones.

## 3. Upgrade / downgrade / reactivate

No confirmed Paystack primitive exists for an in-place plan swap or
un-disabling a subscription (see §13 below), so an upgrade and a
reactivation-after-disable both end up at a fresh Paystack transaction —
but by two different mechanisms since Sprint 18A:

- **`changePlan` (upgrade)** — routes through the invoice-first flow
  (§2), exactly like `subscribe()`: `requiresPayment: true` with a real
  provider creates a `PENDING` invoice and returns it; the fresh
  transaction only happens once the user explicitly clicks "Proceed to
  Payment." This is independent of whether the existing subscription
  already has a `providerSubscriptionId` — see billing.md §5a for why
  that used to matter and no longer does.
- **`changePlan` (downgrade or lateral move)** — `requiresPayment` is
  `false` (billing.md §5a); this NEVER creates an invoice and NEVER
  calls the provider to initiate a charge. If the subscription being
  downgraded away from is backed by a real, confirmed Paystack
  subscription, the ONLY provider call made is
  `provider.cancelSubscription` (`applyDowngradeIfNeeded`) — stopping
  the old recurring charge, never starting a new one. Verified directly
  by e2e test: downgrading calls `initializeTransaction` zero times and
  creates zero `PENDING` invoices.
- **`reactivate`** — unchanged by Sprint 18A, still a direct,
  synchronous call. `cancel()` already calls `provider
.cancelSubscription` (Paystack `disableSubscription`) **immediately**
  when cancellation is requested — the Paystack subscription itself is
  disabled right away, even though `cancelAt` is scheduled for the end
  of the period (LinkIQ's own access continues until then). This means
  reactivating _after_ that has happened cannot be a silent DB-only
  undo — there's nothing left on Paystack's side to "un-disable."
  `reactivate()` therefore calls `provider.createCheckoutSession`
  directly and returns a bare `checkoutUrl` whenever
  `providerSubscriptionId` is set — the one remaining action in this
  codebase that still returns `checkoutUrl` instead of creating a
  reviewable invoice. This was a deliberate scope decision, not an
  oversight: Sprint 18A's spec covers plan selection/upgrade payment,
  and reactivation is a materially different action (resuming a
  cancellation, not choosing a new plan) — see the sprint's own final
  report for the reasoning.

`PaystackBillingProvider.changeSubscription()` always throws — it exists
only to satisfy the `BillingProvider` interface; `SubscriptionsService`
never calls it.

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

**Sprint 18A** added a second, also-additive migration
(`20260818165007_sprint18a_invoice_first_checkout`):

- **`InvoiceStatus` gains `PENDING` and `FAILED`** — a checkout invoice
  awaiting payment, and one whose payment was confirmed unsuccessful (or
  failed independent verification), respectively. Neither existing value
  (`DRAFT`/`OPEN`) was overloaded to mean this — see billing.md §7 for
  why a purpose-built vocabulary was chosen over reusing an unused
  existing one.
- **`Invoice.targetPlanId String? @db.Uuid`** (+ `targetPlan Plan?`
  relation, `Plan.targetOfInvoices Invoice[]` reverse relation) — which
  plan a `PENDING`/in-flight invoice's checkout is FOR. Distinct from
  `Invoice.subscriptionId`, which always points at the workspace's one
  existing `Subscription` row being modified, never the plan being
  purchased. Null for legacy/webhook-recorded invoices that predate this
  field.

Again additive only; every new column nullable or a new enum value; no
historical migration touched; no second payment/invoice table
introduced — the existing `Invoice` model was extended, matching Sprint
11's own precedent of `/admin/payments` and `/admin/invoices` reading the
same underlying rows.

## 6. Plan mapping

| LinkIQ                                                | Paystack                      | Notes                                                                                   |
| ----------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| `Plan`/`PlanPrice` (+ `providerPlanId`, legacy — §7a) | Plan (`plan_code`)            | Not read by checkout since Sprint 18B; kept for a future recurring-billing integration. |
| `Subscription.providerCustomerId`                     | Customer (`customer_code`)    | Stamped by the `charge.success` handler — see §9.                                       |
| `Subscription.providerSubscriptionId`                 | Subscription (packed, §4)     | Set only once `subscription.create` confirms it.                                        |
| `Invoice`                                             | Transaction / recurring cycle | One row per successful or failed charge.                                                |
| `BillingEvent`                                        | any inbound webhook           | Idempotency ledger (billing.md §6), now with a live receiver.                           |

## 7. Payment amounts and currency (Sprint 18A verification rules)

Paystack requires amounts in the account's smallest currency unit
(kobo/cents), matching how `Plan.priceAmount`/`Invoice.amount` are
already stored — no conversion needed. **Platform default currency is
NGN** (Sprint 18B §1) — the account's own native currency; USD and
other configured currencies remain fully supported, just never the
fallback. See `docs/architecture/currency.md` for the full resolution
order (explicit selection > user preference > IP/GeoIP > platform
fallback), which this sprint did not change — only the fallback's
_value_ changed, from USD to NGN.

## 7a. Amount/currency-authoritative checkout — the plan-code drift bug and its fix (Sprint 18B §17)

**Root cause, discovered by a live Paystack TEST-mode transaction during
Sprint 18A's own verification pass**: `createCheckoutSession` (pre-Sprint
18B) initialized every transaction with BOTH `amount: invoice.amount`
**and** `plan: plan.providerPlanId`. Paystack's `/transaction/initialize`
endpoint, when given both fields, silently uses the **plan's own
server-side stored price and currency** and ignores the caller's
`amount` — confirmed directly against the live test account: a
`GET /plan/:code` call showed the test-mode "Starter" plan configured at
`NGN 150000` (kobo) — a value that had drifted completely independently
of LinkIQ's own `Plan.priceAmount`/`Invoice.amount` (at the time, `USD
1900`). The checkout page a real user would have landed on charged the
wrong amount in the wrong currency, with no error raised anywhere in the
flow — a correctness bug, not a rejected/blocked transaction.

**The fix is architectural, not a weakened check**: `checkoutUrl`
creation is now unconditionally amount/currency-authoritative.
`CreateCheckoutSessionInput` gained a required `amountMinorUnits` field;
`PaystackBillingProvider.createCheckoutSession` no longer reads
`Plan.providerPlanId`/`PlanPrice.providerPlanId` **at all**, and never
sends a `plan` field to Paystack — every checkout is a plain,
one-time transaction for exactly `input.amountMinorUnits` /
`input.currencyCode`, always populated by the caller
(`SubscriptionsService.proceedToPayment`/`reactivate`) straight from the
originating `Invoice`'s own stored `amount`/`currency` — the single
source of truth for what a customer is charged, matching billing.md §7's
existing "invoice currency is immutable once meaningful" rule.
`PaystackApiClient.initializeTransaction` now always sends an explicit
`currency` field alongside `amount`, and its `planCode` parameter is
deprecated/unused by every current caller (kept on the interface only
because the client is a thin, provider-shaped wrapper, not because
anything still sets it).

**Consequence — no plan is checkout-blocked by provider configuration
anymore.** `SubscriptionsService.assertPlanIsCheckoutConfigured` (the
Sprint 18A pre-check that rejected a plan with no `providerPlanId`) was
removed entirely, along with `createCheckoutSession`'s own equivalent
gate — see §12's rewrite. `Plan.providerPlanId`/`PlanPrice
.providerPlanId` columns are **kept** (not dropped) as legacy/
informational fields only; nothing in the checkout path reads them.

**Recurring billing note.** This sprint's checkout is a one-time
transaction, matching Sprint 10's original design (§6: "no confirmed
in-place plan-swap/proration primitive" — every upgrade is a fresh
transaction, not a modification of a standing Paystack subscription).
If Paystack's own recurring-subscription engine is adopted in a future
sprint (§6/§13), any Paystack-side plan used for that purpose would need
its price/currency kept in lockstep with the corresponding LinkIQ `Plan`
— exactly the class of drift this sprint's bug demonstrated is otherwise
silent and undetectable from LinkIQ's side. That reconciliation is not
built here; flagged for whoever picks up recurring billing next.

**Invoice currency is immutable once meaningful.** An invoice's
`amount`/`currency` are set at creation from `SubscriptionsService
.resolvePlanPrice` (currency.md's resolution order — explicit selection

> user preference > IP/GeoIP > platform fallback) and may only be
> refreshed while the invoice is still `PENDING` (re-selecting the same
> plan updates them to the latest resolved price — see billing.md §7);
> once an invoice leaves `PENDING` (`PAID` or `FAILED`), nothing ever
> writes to `amount`/`currency` again.

**`proceedToPayment` never accepts a caller-supplied currency.** The
Paystack transaction is always initialized using the invoice's OWN
stored `currency` (`this.assertProviderSupportsCurrency(invoice.currency)`
then `currencyCode: invoice.currency` on `createCheckoutSession`) — the
"Proceed to Payment" endpoint takes no currency parameter at all, so
there is nothing for a frontend value to override even if one were
supplied.

**Unsupported currency is rejected before an invoice is even created.**
`assertProviderSupportsCurrency` (unchanged since Sprint 16) runs before
`createOrReusePendingInvoice` in both `subscribe()` and `changePlan()` —
a currency the configured provider's `getSupportedCurrencies()`
allowlist doesn't include throws `BadRequestException` immediately,
never producing a `PENDING` invoice a payment could never actually be
completed in.

**A currency can pass that static allowlist and still be rejected by the
live Paystack account** — `getSupportedCurrencies()` is an
operator-configured list (`paystack.config.ts`), not a live query against
the merchant account's actual enabled currencies (Paystack exposes no
clean API for that). Sprint 18B's own browser verification hit exactly
this: `PAYSTACK_SUPPORTED_CURRENCIES` included USD, but the real
TEST-mode account only had NGN enabled, so `POST /transaction/initialize`
returned HTTP 403 "Currency not supported by merchant" — which, before
this fix, propagated as an unhandled `PaystackApiException` (an opaque
500). `PaystackBillingProvider.createCheckoutSession` now catches a 403
specifically and rethrows the same friendly, actionable
`BadRequestException` message `assertProviderSupportsCurrency` already
uses (`"Payment in ${code} is not currently available. Please select
another currency."`) — so both the static-allowlist rejection and the
live-account rejection read identically to the customer, and neither
case is a 500.

**Paystack transaction currency must match the invoice's currency
exactly** — enforced by `confirmAndActivate`'s verification checklist
(§2a): a provider-reported currency that differs from the invoice's own
stored currency marks the invoice `FAILED` rather than activating
anything.

## 8. Subscription state machine

| Transition                         | Trigger                                                                                                         | Effect                                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| (none) → `TRIALING`                | `subscribe()`, plan has `trialDays`                                                                             | LinkIQ-only, zero Paystack calls, no invoice created.                                                                                    |
| PENDING invoice → `ACTIVE`         | `confirmAndActivate` (§2a), via the checkout-callback route OR `charge.success` webhook — whichever fires first | Verification-gated, idempotent activation (Sprint 18A) — see §2a. Sets `providerCustomerId`, `currentPeriodStart/End`; invoice → `PAID`. |
| — → subscription confirmed         | `subscription.create` webhook                                                                                   | Fills in `providerSubscriptionId`/`providerPriceId`/`currentPeriodEnd`; emits `SUBSCRIPTION_CREATED`.                                    |
| `ACTIVE` → `PAST_DUE`              | `invoice.payment_failed` webhook                                                                                | `pastDueSince` set (only if not already set — preserves the original failure time across repeat failures).                               |
| `PAST_DUE` → `ACTIVE`              | User manually re-pays (fresh checkout — **Paystack never auto-retries**) → `charge.success`                     | `pastDueSince` cleared.                                                                                                                  |
| `PAST_DUE` → `EXPIRED`             | Derived, read-time                                                                                              | `pastDueSince` older than the grace window — see billing.md §3.                                                                          |
| `ACTIVE` → pending-`CANCELED`      | `cancel()`                                                                                                      | Unchanged from Sprint 7 — `cancelAt = currentPeriodEnd`; now also calls Paystack's disable-subscription immediately.                     |
| provider-initiated disable         | `subscription.disable` webhook, `cancelAt` not already set                                                      | Sets `cancelAt`/`canceledAt` to now — covers Paystack auto-disabling after repeated failures, which LinkIQ never asked for.              |
| provider disable, LinkIQ-initiated | `subscription.disable` webhook, `cancelAt` already set                                                          | No-op — this is just Paystack's confirmation echo of `cancel()`'s own call.                                                              |
| Upgrade                            | Invoice-first flow (§2/§3) — PENDING invoice, then `confirmAndActivate` on verified payment                     | No proration; applied only once verified — never at plan-selection time.                                                                 |
| Downgrade                          | Applied directly (§3) — never an invoice, never a charge                                                        | No proration; immediate, not scheduled — see billing.md §5a.                                                                             |

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
Paystack says" path. `confirmAndActivate` (§2a) applies the identical
principle to invoices — an already-`PAID`/`FAILED` invoice is never
touched again regardless of what a later event claims.

**Callback vs. webhook correlation (Sprint 18A)**: `charge.success`
first tries `confirmAndActivate` (§2a), which correlates by the
Paystack reference (attached by `proceedToPayment`) or, failing that,
`metadata.invoiceId`. When NEITHER correlates — a transaction that never
went through the invoice-first flow at all, e.g. a Paystack-initiated
recurring-cycle charge, or a legacy/test webhook payload carrying only
the old `{workspaceId, planSlug}` metadata shape — `handleChargeSuccess`
falls back to its original Sprint 10 direct-apply logic unchanged
(correlating via `metadata.workspaceId`/`planSlug` +
`customer.customer_code`, updating the `Subscription` directly, and
recording a PAID invoice via `recordProviderInvoice`). This keeps
backward compatibility with anything that predates Sprint 18A without
requiring a second, parallel activation path — it's the exact same
handler, just with `confirmAndActivate` tried first.

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

**Handled event types**: `charge.success` (tries `confirmAndActivate`
first, §2a/§8, falling back to the original Sprint 10 direct-apply logic
when nothing correlates), `subscription.create`, `subscription.disable`,
`invoice.payment_failed`. Every other event type
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
- **Invoice-level idempotency (Sprint 18A)** — `confirmAndActivate`'s
  short-circuit on an already-`PAID`/`FAILED` invoice (§2a) is a second,
  independent idempotency layer on top of `BillingEvent`'s own — even if
  a webhook and a callback both reach `confirmAndActivate` for the same
  reference, only the first one to observe the invoice as `PENDING`
  performs the transition; the second observes `PAID`/`FAILED` and
  no-ops.
- **The checkout-callback route never trusts the query string alone.**
  Both the redirect-back reference AND the eventual success/failure
  determination come from an independent, server-side call to
  `provider.verifyTransaction` — a forged or replayed
  `?reference=...&success=true`-style query parameter (LinkIQ's callback
  route doesn't even read such a parameter) can never itself activate
  anything.
- **Logging**: `PaystackApiClient` never logs its request body or
  Authorization header, even on failure — only the HTTP status and
  Paystack's own `message` field.
- **Audit actions**: `billing.invoice_created` (Sprint 18A — a PENDING
  invoice was created at plan-selection time), `billing.checkout_initiated`
  (now recorded against the `Invoice` entity, at "Proceed to Payment"
  time — not at plan-selection time), `billing.payment_succeeded`,
  `billing.payment_failed`, `billing.subscription_activated`,
  `billing.subscription_disabled` — same `action: 'billing.*'`
  convention as Sprint 7, never including the secret key or raw payload
  in `metadata`.

## 11. Frontend

- `billing-api.ts`: `subscribe`/`changePlan` return
  `SubscriptionMutationResultDto` (`SubscriptionDto` +
  `checkoutUrl: string | null` + `invoice: InvoiceDto | null`, Sprint
  18A). `reactivateSubscription` still only ever returns `checkoutUrl`
  (§3). A new `proceedToPayment(workspaceId, invoiceId)` calls
  `POST .../invoices/:invoiceId/pay` and returns `{ checkoutUrl }`.
  `verifyCheckout(workspaceId, reference)` now hits the upgraded,
  verification-and-activation `checkout/callback` endpoint — its
  response shape gained `invoice: InvoiceDto | null` alongside the
  existing `success`/`subscription`.
- `/dashboard/billing/page.tsx`: selecting a plan no longer redirects
  directly. A non-null `result.invoice` opens `InvoiceReviewDialog`
  (new component, `components/billing/invoice-review-dialog.tsx`)
  instead of `PlanChangeConfirmDialog` — invoice number, target plan,
  billing period, due date, total, payment gateway; its own "Proceed to
  Payment" button calls `proceedToPayment` and redirects to the
  returned `checkoutUrl`. A non-null `result.checkoutUrl` (only ever
  reachable via `reactivate()`) still triggers an immediate redirect,
  unchanged. The billing-history table shows a "Pay now" action on any
  `PENDING` row, calling `proceedToPayment` directly — the retry path
  for an abandoned checkout (§2a) without re-walking plan selection.
- `/dashboard/billing/callback/page.tsx`: reads `?reference=` from the
  URL, calls `verifyCheckout` — which now performs real server-side
  verification and activation, not a read-only peek — and shows exactly
  two outcomes: **success** ("Payment successful" / "Your plan has been
  upgraded to {plan}.") or **failed** ("Payment was not completed." /
  "Your current plan is unchanged."). The prior three-state
  verifying/success/pending/failed model is gone along with the
  "pending — webhook hasn't landed yet" ambiguity it existed for: the
  callback's own verification call is now authoritative the moment it
  returns.

## 12. What's purchasable via automated checkout

**Any plan whose resolved price is greater than 0** in the customer's
resolved currency is purchasable — since Sprint 18B (§7a), checkout no
longer depends on `Plan.providerPlanId` being set at all, because
checkout is amount/currency-driven, not plan-code-driven.
`SubscriptionsService.determinePaymentRequirement` is what actually
decides whether payment is needed for a given plan change (billing.md
§5a) — a $0 plan (FREE, or ENTERPRISE's "contract pricing" placeholder)
never requires payment and is applied directly, exactly as Sprint 17
always did; every other plan reaches the invoice-first flow regardless
of whether it has ever had a Paystack `plan_code` configured.
`Plan.providerPlanId`/`PlanPrice.providerPlanId` remain available as
legacy/informational fields (e.g. for a future recurring-billing
integration, §7a) but are not read anywhere in the checkout path.

## 13. Known limitations

- **No confirmed native proration/plan-swap primitive** — every upgrade
  is a fresh Paystack transaction (via the invoice-first flow, §2), no
  partial-period credit (§3).
- **No reconciliation between a `Plan`'s LinkIQ price and any
  Paystack-dashboard-configured plan** (§7a) — since checkout is
  amount/currency-authoritative and never reads `providerPlanId`, this
  is no longer a correctness risk for one-time checkout, but it remains
  a real gap for any _future_ Paystack-native recurring-subscription
  integration, which would need such reconciliation built explicitly.
- **A `PENDING` invoice never auto-expires** (Sprint 18A) — there is no
  background job or TTL; an abandoned checkout's invoice stays `PENDING`
  indefinitely and remains retriable forever via "Pay now." A deliberate
  simplification — building an expiry/reaper mechanism was out of scope
  for this sprint.
- **No mock payment-success path exists in production code** (Sprint
  18A, by explicit instruction) — every test that needs a simulated
  Paystack response substitutes a fake `PaystackApiClient` via DI
  (`test/paystack-checkout.e2e-spec.ts`'s `makeFakeApiClient`), never a
  `NODE_ENV`-gated branch inside `SubscriptionsService`/
  `PaystackBillingProvider`/`PaystackWebhookProcessor` themselves.
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
  `getEffectiveStatus`'s `PAST_DUE → EXPIRED` branch. `SubscriptionsService`
  (Sprint 18A): `createOrReusePendingInvoice`-branch coverage for
  `subscribe`/`changePlan`, `proceedToPayment` (invoice's-own-currency
  enforcement, missing-invoice rejection), `confirmAndActivate`
  (successful activation, amount mismatch, currency mismatch,
  non-success provider status, idempotent repeat on `PAID`, idempotent
  repeat on `FAILED`, no-correlation fallback signal). `InvoicesService`:
  `createOrReusePendingInvoice`'s create-vs-reuse branching,
  `attachProviderReference`/`markPaid`/`markFailed`.
- **E2E — inbound** (`test/paystack-webhooks.e2e-spec.ts`, unchanged by
  Sprint 18A): posts synthetic Paystack-shaped payloads with a correctly
  computed HMAC-SHA512 signature directly at `/webhooks/paystack`, and
  polls for the resulting DB state — **no real Paystack network call
  anywhere in the automated suite.** Covers: signature rejection
  (missing/wrong-secret/tampered-body), `charge.success` activation +
  invoice recording via the legacy-fallback path (no `metadata.invoiceId`
  in these payloads — proving Sprint 18A's backward-compatibility
  fallback, §8), exact-redelivery idempotency, unresolvable-metadata
  failure handling, `subscription.create` correlation, `subscription
.disable`'s LinkIQ-initiated-vs-provider-initiated branching, `invoice
.payment_failed` → `PAST_DUE`, and unrecognized-event no-ops.
- **E2E — invoice-first checkout** (`test/paystack-checkout.e2e-spec.ts`,
  Sprint 18A additions): a fake `PaystackApiClient` substituted via
  `overrideProvider` — `initializeTransaction` generates a real-looking
  reference, `verifyTransaction` echoes back whatever reference it's
  called with (matching real Paystack behavior, and required for
  `confirmAndActivate`'s reference-based correlation to find the right
  invoice). Covers: plan selection creates a PENDING invoice with no
  Paystack call; a plan with no `providerPlanId` is still fully
  checkout-able (Sprint 18B §7a — no longer rejected); `proceedToPayment`
  initializes a real transaction and attaches its reference, and never
  sends a `plan` field; the callback independently verifies and
  activates only on success; a repeat callback call is idempotent (byte-
  identical response, no duplicate invoice); an amount mismatch is
  rejected (invoice → `FAILED`, subscription unchanged); a downgrade
  creates zero invoices and calls `initializeTransaction` zero times.
  `test/currency.e2e-spec.ts` additionally covers a non-base-currency
  invoice (USD, since NGN is now the platform default) carrying its own
  currency through to `proceedToPayment`'s Paystack call.
- **E2E — admin plan pricing** (`test/admin.e2e-spec.ts`, Sprint 18B
  additions): a new plan defaults to NGN when `currency` is omitted; a
  large, non-round minor-unit `priceAmount` round-trips exactly through
  create → get and create → update, with no float-driven drift; an
  amount above `MAX_MONEY_MINOR_UNITS` is rejected `400`, never clamped;
  a non-integer (decimal-float) `priceAmount` is rejected `400`, never
  silently truncated.
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
