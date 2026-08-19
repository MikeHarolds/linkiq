# Billing Architecture

Sprint 7 introduced the billing _foundation_: plans, a per-workspace
subscription, usage tracking, and limit enforcement, with no real payment
provider — every mutation applied directly against LinkIQ's own database.
Sprint 10 crossed that boundary: **Paystack is now a real, optional
`BillingProvider` implementation** (`BILLING_PROVIDER=paystack`), covering
real checkout, real recurring charges, and a real inbound webhook
receiver. Sprint 18A replaced Sprint 10's one-step "select a plan, get
redirected" checkout with an **invoice-first** flow — a `PENDING` invoice
is created and shown for review before any Paystack transaction exists,
and activation only ever happens after independent, server-side payment
verification. `BILLING_PROVIDER=development` (the default) remains
completely unchanged from Sprint 7 throughout all of this — this document
describes the domain model shared by every provider; see
**[paystack-integration.md](./paystack-integration.md)** for everything
specific to the real provider (invoice-first checkout flow, webhook
processing, state machine, security).

## 1. Core principle: billing enforcement is a gate in front of writes, never a dependency of reads or redirects

Every plan-limit check happens at the moment a workspace tries to _create_
something new (a link, a QR code, a campaign, a custom domain, a team
member) — never when reading existing data, and never on the redirect hot
path. `RedirectService` and `redirect-route.ts` have no dependency on the
billing module at all, not even an unused import — this is enforced by
inspection, not by a runtime check, because the spec is explicit: _"the
redirect engine must remain independent from billing enforcement"_ and
_"do not break public redirects simply because a workspace has exhausted a
billing limit."_ A workspace that is over its link limit still has every
one of its existing links redirect, still records clicks for them, and
still sees its existing analytics — only the _next_ `POST` is blocked.
`MONTHLY_CLICKS` is tracked and shown on the usage dashboard, but is
**never enforced** — clicks are never blocked, for the same reason.

## 2. Database model

```
Plan
  id, name, slug (unique), tier, description
  priceAmount (cents), currency, billingInterval, trialDays
  isActive, displayOrder
  limits -> PlanLimit[]

PlanLimit
  id, planId, key (MAX_LINKS | MAX_QR_CODES | MAX_CAMPAIGNS |
                    MAX_CUSTOM_DOMAINS | MAX_TEAM_MEMBERS |
                    MONTHLY_CLICKS | ANALYTICS_RETENTION_DAYS)
  value   (Int?  — null = unlimited, 0 = feature disabled)
  @@unique([planId, key])

Subscription
  id, workspaceId (unique — one subscription per workspace)
  planId, status (TRIALING | ACTIVE | PAST_DUE | PAUSED | CANCELED | EXPIRED)
  currentPeriodStart, currentPeriodEnd
  trialStart, trialEnd
  cancelAt, canceledAt
  pastDueSince   (Sprint 10 — see paystack-integration.md §8)
  provider, providerCustomerId, providerSubscriptionId, providerPriceId

BillingEvent   (webhook idempotency ledger — see §6)
  id, provider, externalEventId, eventType, status, payload
  @@unique([provider, externalEventId])

Invoice        (billing history AND the invoice-first checkout ledger — see §7)
  id, workspaceId, subscriptionId?, targetPlanId?  (Sprint 18A — which
                                                     plan this checkout is FOR)
  number, amount, currency
  status (DRAFT | OPEN | PAID | VOID | UNCOLLECTIBLE | REFUNDED |
          PENDING | FAILED)   (PENDING/FAILED added Sprint 18A)
  provider, providerInvoiceId   (Sprint 18A — holds the Paystack
                                  transaction reference from the moment
                                  checkout is initialized, not only once
                                  paid)
  failureReason   (Sprint 10 — why a charge/cycle failed; Sprint 18A also
                    sets this on independent-verification failure)
  @@unique([workspaceId, number])
```

Plan also gained `providerPlanId` (Sprint 10) — the corresponding
Paystack `plan_code` for a purchasable plan; null for FREE/ENTERPRISE
(neither is purchasable via automated checkout). See
paystack-integration.md §5 for the full migration.

`Workspace` gains `subscription Subscription?` and `invoices Invoice[]`.
Migration: `20260812202020_add_billing_subscriptions` — the only migration
this sprint added; no historical migration was touched.

**Every workspace has exactly one subscription, created transactionally at
workspace-creation time.** Both places a workspace comes into existence —
`AuthService.register` and `WorkspacesService.create` — call
`SubscriptionsService.createDefaultSubscription(tx, workspaceId)` _inside_
their existing `prisma.$transaction`, so a workspace can never exist
without a subscription, even under a crash mid-request. Pre-Sprint-7
workspaces in an existing database are covered by an idempotent backfill
pass in `seed.ts` (`backfillMissingSubscriptions`), and `BillingUsageService`
independently tolerates a missing subscription anyway (§4) — the backfill
is belt-and-braces, not load-bearing.

## 3. Effective status is derived, never stored — no background job

Mirroring the exact pattern `LinkStatus` (expiry) and `CampaignStatus`
(completion) already established: a `Subscription.status` column can go
stale the instant a `trialEnd` or `cancelAt` timestamp passes, with
nothing to update it. Rather than run a cron job to "fix" the stored
status, `getEffectiveStatus(subscription, now)`
(`billing/utils/effective-status.ts`) derives the true status on every
read:

- `TRIALING` whose `trialEnd` has passed → `EXPIRED`
- `cancelAt` set and already passed → `CANCELED` (checked before the
  `PAST_DUE` branch below, so an explicit cancellation always wins over a
  passively-aged-out failed charge)
- `PAST_DUE` whose `pastDueSince` is older than `pastDueGraceDays`
  (default 7, `PAYSTACK_PAST_DUE_GRACE_DAYS`) → `EXPIRED` (Sprint 10 —
  see paystack-integration.md §8; a LinkIQ-side compensating control,
  since Paystack never auto-retries a failed recurring charge)
- otherwise → the stored `status`, unchanged

`isEffectivelyOnPlan(status)` is `true` for `ACTIVE`, `TRIALING`, and
`PAST_DUE` — the three statuses that mean "still evaluate limits against
the subscribed plan." Everything else falls back to the FREE plan's
limits (§4), never to zero and never to an error.

## 4. Usage & limit enforcement

`BillingUsageService` answers "can this workspace do X?" without any
caller needing to know a specific number or which plan a workspace is on.

**Resolution order for every check** (`SubscriptionsService.getEffectivePlan`):

1. No subscription row at all (never backfilled) → FREE plan.
2. Subscription exists but its effective status isn't on-plan (expired
   trial, past cancellation, paused, past-due handled specially — see
   below) → FREE plan.
3. Otherwise → the subscribed plan.

**Per-key resolution** (`limitFromPlan`):

- `PlanLimit.value === null` → unlimited, never blocks.
- `PlanLimit.value === 0` → always blocks (a disabled feature).
- No `PlanLimit` row configured for that key at all → **treated as
  unlimited** (fail-open, not a thrown error). This is a deliberate
  choice: a seed/config gap must never accidentally lock a paying
  workspace out of its own product, consistent with §1's "never break
  existing usage over a billing gap" principle. It's called out here as a
  known limitation — a stricter deployment might prefer fail-closed.

**Usage counting is always a live query, never a duplicate counter**:
`MAX_LINKS`/`MAX_QR_CODES`/`MAX_CAMPAIGNS`/`MAX_CUSTOM_DOMAINS` are plain
`prisma.<model>.count({ where: { workspaceId, deletedAt: null } })`, and
`MAX_TEAM_MEMBERS` is `workspaceMember.count()`. `MONTHLY_CLICKS` sums the
existing Sprint 3 `LinkDailyStat` rollup over the subscription's current
billing period (or calendar-month-to-date when there's no period — FREE
plans and un-backfilled workspaces). No new click-counting table exists
anywhere in this sprint.

**The single call every enforcement site uses**:

```ts
await this.billingUsage.assertCanUse(workspaceId, 'MAX_LINKS', 'links');
```

One query pass; throws `PlanLimitExceededException` (403) with a
structured body if there's no remaining capacity, resolves silently
otherwise. Enforcement sites, one call each, right after basic request
validation and before the database write:

| Service             | Method         | Key                  |
| ------------------- | -------------- | -------------------- |
| `LinksService`      | `create`       | `MAX_LINKS`          |
| `QrCodesService`    | `create`       | `MAX_QR_CODES`       |
| `CampaignsService`  | `create`       | `MAX_CAMPAIGNS`      |
| `DomainsService`    | `create`       | `MAX_CUSTOM_DOMAINS` |
| `WorkspacesService` | `inviteMember` | `MAX_TEAM_MEMBERS`   |

`PlanLimitExceededException extends ForbiddenException`, with a response
body of `{ code: 'PLAN_LIMIT_REACHED', feature, limit, usage, remaining,
message }`. `HttpExceptionFilter` was extended (additively) to spread any
object-shaped exception response into the final JSON payload alongside
the standard `statusCode`/`message`/`error`/`path`/`timestamp` envelope —
every pre-Sprint-7 exception only ever passed a string or `{ message }`,
so this changes nothing for them.

## 5. Provider abstraction

`BillingProvider` (`billing/providers/billing-provider.interface.ts`) is
the seam a real payment processor plugs into — `createCheckoutSession`,
`cancelSubscription`, `changeSubscription`, `getSubscription`,
`handleWebhook`, `verifyTransaction` (Sprint 10) — every method
provider-agnostic, no Paystack/Stripe/etc. naming leaking into the
interface. Selected via the `BILLING_PROVIDER` DI token, factory-chosen
in `billing.module.ts` off the `BILLING_PROVIDER` env var, the same
shape as Sprint 6's `DOMAIN_VERIFICATION_PROVIDER`.

Two implementations now exist:

- **`DevelopmentBillingProvider`** (default, `BILLING_PROVIDER=development`
  or unset): every method is a no-op or logs-only; `createCheckoutSession`
  returns `{ devFlow: true }` (no real checkout URL) — which is why
  `SubscriptionsService.subscribe`/`changePlan`/`reactivate` apply the
  plan change directly against LinkIQ's own database instead of
  redirecting anywhere. Behavior is byte-for-byte identical to Sprint 7.
- **`PaystackBillingProvider`** (`BILLING_PROVIDER=paystack`, Sprint 10):
  a real implementation backed by Paystack — see
  [paystack-integration.md](./paystack-integration.md) for everything
  provider-specific (checkout flow, webhook processing, state machine,
  security). Nothing in `PlansService`, `BillingUsageService`, the
  controller's read routes, or the frontend's usage/plans UI needed to
  change for this — exactly the seam §5 was designed for.

## 5a. When does a plan change actually require payment? (Sprint 17)

Before Sprint 17, `subscribe()` required checkout whenever the target
plan had no trial, and `changePlan()` required checkout only when the
_existing_ subscription already had a confirmed
`providerSubscriptionId`. Both were wrong in ways that only showed up
once real money was involved: a workspace's very first paid conversion
(moving off the seeded FREE default, which never has a
`providerSubscriptionId`) always applied instantly with **zero
payment**, and — in the other direction — a downgrade away from an
already-paid plan re-triggered a **fresh charge** for the cheaper plan.

`SubscriptionsService.determinePaymentRequirement()` is now the single
decision point both `subscribe()` and `changePlan()` call, based on
comparing the target plan's resolved price against
`Subscription.amount` — the workspace's own currently-paid amount
(Sprint 16's immutable snapshot, never the plan's live price):

- **Upgrade** (resolved price > current amount): requires a real
  checkout, UNLESS this is the workspace's first-ever trial on a plan
  that offers one (see `Subscription.trialUsed` — a permanent flag,
  deliberately separate from `trialStart`/`trialEnd`, which represent
  the _current_ trial window and get cleared once it ends; without a
  separate permanent flag, a workspace could be re-granted a trial —
  and skip payment — on every subsequent plan switch).
- **Downgrade or lateral move** (resolved price <= current amount):
  applies immediately, never charges. If the subscription being
  downgraded away from is backed by a real, confirmed Paystack
  subscription, that subscription is canceled
  (`applyDowngradeIfNeeded`) so the workspace is never billed the old,
  higher amount again. This is a deliberate, documented simplification
  — an _immediate_ downgrade rather than one scheduled for the next
  renewal — chosen because Paystack has no proration primitive to
  adjust an existing subscription's amount in place (see
  [paystack-integration.md](./paystack-integration.md) §13), and a
  renewal-scheduling mechanism didn't otherwise exist in this codebase.

The customer-facing dashboard (`/dashboard/billing`) surfaces this
decision _before_ the user commits to it: clicking a plan opens
`PlanChangeConfirmDialog` (a preview of the same rule, not a second
implementation of it) showing the resolved price, whether the change
is an upgrade or downgrade, and — for a paid upgrade — which payment
gateway will process it (`BillingSummaryDto.activeProvider`, sourced
from `BillingProvider.getProviderName?()`; `null` when no real gateway
is configured, in which case the change simply applies with no
gateway-selection step). The backend enforces the same rule
independently either way — the dialog is a UX courtesy, not the
authorization boundary.

**Sprint 18A — what "requires a real checkout" now means.** Before
Sprint 18A, `requiresPayment: true` with a real provider configured
meant `subscribe()`/`changePlan()` called `provider
.createCheckoutSession()` immediately and returned a bare
`checkoutUrl` — the very same request that decided payment was needed
also initialized the Paystack transaction. Sprint 18A splits that in
two: `requiresPayment: true` with a real provider now creates (or
reuses) a **PENDING** `Invoice` via `InvoicesService
.createOrReusePendingInvoice` and returns it as `SubscriptionMutation
ResultDto.invoice` — `checkoutUrl` stays `null` and nothing about the
subscription changes. A real Paystack transaction is only ever
initialized by the separate, explicit `POST .../invoices/:invoiceId
/pay` action (`SubscriptionsService.proceedToPayment`) — see
[paystack-integration.md](./paystack-integration.md) §2 for the full
invoice-first sequence. `requiresPayment: false` (downgrade, lateral
move, or a first-ever trial) is completely unchanged by this — those
paths never create an invoice and never call the provider.

## 6. Webhook idempotency

`BillingEventsService.recordEvent({ provider, externalEventId, eventType,
payload })` relies on `BillingEvent`'s `@@unique([provider,
externalEventId])` plus the shared `isUniqueConstraintViolation` helper
(`common/utils/prisma-errors.ts`) to make a duplicate delivery a harmless
no-op — it returns the existing row with `isNew: false` instead of
throwing or creating a second record. Proven directly by
`billing-events.service.spec.ts` (calling `recordEvent` twice with the
same `externalEventId`).

**Sprint 10 wires this up to a real HTTP receiver**:
`PaystackWebhookController` (`POST /webhooks/paystack`, public,
signature-verified) is the first live caller — see
paystack-integration.md §9 for the full inbound pipeline (signature
verification → idempotency recording → async BullMQ processing → guarded
state transitions).

## 7. Invoices

`InvoicesService.listForWorkspace`/`listAllForAdmin` read. Two families
of write paths exist, and there is still no user-facing endpoint that
can fabricate a PAID record directly — every PAID transition is either
a confirmed provider webhook or a server-side-verified transaction:

- **`recordProviderInvoice`** (Sprint 10) — a one-shot PAID or
  UNCOLLECTIBLE record for provider events that don't go through the
  invoice-first flow below: a recurring-cycle charge/failure Paystack
  generates on its own against an already-active subscription (see
  paystack-integration.md §8's `charge.success`-fallback and
  `invoice.payment_failed` rows).
- **The invoice-first checkout ledger** (Sprint 18A) —
  `createOrReusePendingInvoice` / `attachProviderReference` /
  `markPaid` / `markFailed`, the write path behind the flow in §5a and
  paystack-integration.md §2. An invoice moves through exactly these
  states:

  - **`PENDING`** — created the moment a paid plan selection is made
    (before any Paystack transaction exists); still `PENDING` after
    `proceedToPayment` initializes the checkout (only `providerInvoiceId`
    changes, to the Paystack reference). A workspace can have at most
    one `PENDING` invoice per target plan — reselecting the same plan or
    retrying an abandoned checkout reuses the same row rather than
    creating a duplicate (see "retry" below).
  - **`PAID`** — terminal. Set only by `SubscriptionsService
.confirmAndActivate` after independently verifying the transaction
    (reference, amount, currency, and — where available — workspace all
    match the invoice's own stored values) with the payment provider.
    Setting `PAID` and activating the subscription happen in the same
    call, never independently.
  - **`FAILED`** — terminal. Set when `confirmAndActivate`'s
    verification fails (provider reports a non-success status, or an
    amount/currency/workspace mismatch — see paystack-integration.md
    §2a). A `FAILED` invoice is never resurrected to `PAID` by a later
    or replayed signal — LinkIQ's financial history stays honest. A
    retry after failure is a **new** plan selection (a new `PENDING`
    invoice), not a mutation of the failed one.

  **Abandoned payment**: if the user never completes checkout (closes
  the Paystack tab, or the browser never returns), no callback and no
  webhook ever fires — the invoice simply stays `PENDING` indefinitely.
  Nothing times it out. It remains visible and retriable (a "Pay now"
  action re-invokes `proceedToPayment` against the same invoice) from
  both `/dashboard/billing`'s billing-history table and a repeat plan
  selection.

  **Idempotent activation**: `confirmAndActivate` is the single function
  both the checkout-callback route and the inbound webhook call (see
  paystack-integration.md §2/§9) — whichever fires first performs the
  real state transition; it looks up the invoice by provider reference
  first and short-circuits with no re-processing (no re-audit, no
  re-role-sync, no re-activation) whenever the invoice is already `PAID`
  or `FAILED`. Duplicate webhook delivery is additionally caught by
  `BillingEvent`'s own idempotency ledger (§6) before `confirmAndActivate`
  is ever reached a second time for the same event.

**`Invoice.periodStart`/`Invoice.periodEnd`** (Sprint 18B, additive —
see §"Sprint 18B" migration note below) — a snapshot of the billing
period the invoice's payment covers, written by `markPaid` at the exact
moment `confirmAndActivate` marks the invoice `PAID` (the same
`now`/`addDays(now, periodDays)` values already computed for the
`Subscription` row itself). `PENDING`/`FAILED` invoices always have
`null` here — a period is only meaningful once payment is confirmed.
This lets the customer invoice/receipt views (§10) show the correct
billing period without a second lookup, and stays accurate even if the
subscription's own current period later advances.

**Invoice as receipt (Sprint 18B §11)** — no separate `Receipt` entity
was introduced. A `PAID` invoice already carries every field a receipt
needs (`number` doubles as the receipt number, `amount`, `currency`,
`provider`, `providerInvoiceId`, `paidAt`, `periodStart`/`periodEnd`),
so the customer-facing receipt view (`ReceiptDialog`, §10) is a
read-only, differently-styled render of the same already-fetched
`InvoiceDto` — never a new query, never a new write path — rendered
only when `status === 'PAID'`, so a receipt can never represent an
unverified or fabricated payment.

## 7a. Featured Plans (Sprint 17)

`Plan.isFeaturedOnHomepage`/`homepageOrder` control the public
marketing pricing section independently of `isActive`. Three
consumers, three different questions:

- **`PlansService.listActive()`** — every active, purchasable plan.
  Read by the authenticated dashboard's plan switcher
  (`GET /workspaces/:id/billing/plans`) — a customer can subscribe to
  any active plan, whether or not it's featured on the homepage.
- **`PlansService.listFeaturedForHomepage()`** — active AND explicitly
  featured. The _only_ list `PublicController.getPlans()`
  (`GET /public/plans`, unauthenticated) ever returns. Sorted by
  `homepageOrder` when set, falling back to `displayOrder` — never a
  hardcoded slug list.
- **`PlansService.listAllForAdmin()`** — unfiltered, for the admin
  catalog view, where an operator toggles both flags via
  `PATCH /admin/plans/:id { isFeaturedOnHomepage, homepageOrder }`.

Marking a plan featured has no effect on checkout, entitlement, or
role resolution — it is purely a homepage-visibility switch.

## 8. RBAC — deliberately different from every other Sprint 6 module

Every other Sprint 5/6 module (Links, QR Codes, Campaigns, Custom
Domains) lets `MEMBER` mutate. Billing does not — the spec is explicit:
_"MEMBER should not automatically manage billing"_, _"ADMIN/OWNER can
manage subscription and billing settings."_

- `GET /billing`, `/billing/usage`, `/billing/plans`, `/billing/invoices`
  → `VIEWER` and above (read-only).
- `POST /billing/subscribe`, `/change-plan`, `/cancel`, `/reactivate` →
  `ADMIN` and above (`OWNER` satisfies this too, via the existing role
  hierarchy).

## 9. Audit logging

Every mutation is recorded via the shared `AuditService`, entity
`Subscription`: `subscription.created`, `billing.trial_started` (only
when a trial is actually granted), `billing.plan_changed`,
`subscription.canceled`, `subscription.reactivated`, and
`billing.limit_reached` (recorded by `BillingUsageService.assertCanUse`
itself, right before throwing, so every blocked action leaves an audit
trail with no extra call needed at any of the five enforcement sites).
No payload ever includes card numbers, CVVs, passwords, or provider
secrets — there is no real payment data anywhere in this system to leak.

## 10. Frontend

`/dashboard/billing`: current plan (name, status badge, price, billing
period, trial window, pending-cancellation notice), a usage section (one
progress row per metered key, "Unlimited" for `null` limits, a red bar
plus upgrade prompt when exhausted), a plan-comparison grid (subscribe or
switch, gated to `ADMIN`/`OWNER` — `MEMBER`/`VIEWER` see the same cards
read-only), an **Invoices** card (Sprint 18B §10 — number, plan, amount,
currency, status, dates, with a "Pay now" action on any `PENDING` row,
"View Invoice" always, and "View Receipt" once `PAID`), and a **Payment
history** card (Sprint 18B §13 — date, provider, amount, and a
Success/Failed result badge, derived from the same invoice rows'
`PAID`/`FAILED` terminal states — no separate payment-history table
exists or was added, consistent with §7's "no duplicate payment logic").
`InvoiceDetailDialog` and `ReceiptDialog` (both new, Sprint 18B) are
read-only views over the exact same `InvoiceDto` already on the page —
neither issues its own fetch or mutation. "Download Receipt" generates a
plain-text file client-side (`Blob` + a temporary `<a download>`) from
data already on screen — a real, functional download, not a PDF (no
PDF-generation infrastructure exists in this codebase) and not a
placeholder.

Selecting a plan never redirects straight to Paystack any more (Sprint
18A). The flow is: `PlanChangeConfirmDialog` (preview) → confirm →
if the response includes a non-null `invoice`, `InvoiceReviewDialog`
replaces it — invoice number, target plan, billing period, due date,
total, and payment gateway, with an explicit "you're still on the
{current} plan" note and a "Proceed to Payment" button. Only that
button's click calls `POST .../invoices/:invoiceId/pay` and redirects
the browser to the returned `checkoutUrl`. `reactivate()` is the one
remaining action that can still return a bare `checkoutUrl` directly
(see paystack-integration.md §3) — the frontend redirects to it exactly
as before. With no provider configured, `checkoutUrl`/`invoice` are
always null and every change applies immediately, exactly as in Sprint 7.

`/dashboard/billing/callback` is where the browser lands after a
redirect-based Paystack checkout. It no longer merely reports a
fast-path status — see paystack-integration.md §2/§11: the callback
endpoint it calls now performs real, server-side verification and
activation. Copy is deliberately never worded as if the plan is already
active before that completes: "Payment successful — Your plan has been
upgraded to {plan}." on success, "Payment was not completed. — Your
current plan is unchanged." on failure.

## 11. API surface

```
GET  /api/v1/workspaces/:workspaceId/billing                    summary: subscription, effective plan, usage, invoice count
GET  /api/v1/workspaces/:workspaceId/billing/usage               per-feature usage/limit/remaining
GET  /api/v1/workspaces/:workspaceId/billing/plans                all active plans + limits
GET  /api/v1/workspaces/:workspaceId/billing/invoices             billing history (may be empty) — includes PENDING/FAILED rows
GET  /api/v1/workspaces/:workspaceId/billing/checkout/callback    Sprint 18A — verifies server-side and activates on success, ?reference=
POST /api/v1/workspaces/:workspaceId/billing/subscribe            { planSlug } — may return { invoice } (PENDING) or apply directly
POST /api/v1/workspaces/:workspaceId/billing/change-plan          { planSlug } — may return { invoice } (PENDING) or apply directly
POST /api/v1/workspaces/:workspaceId/billing/invoices/:invoiceId/pay   Sprint 18A — "Proceed to Payment": initializes the real Paystack transaction, returns { checkoutUrl }
POST /api/v1/workspaces/:workspaceId/billing/cancel                schedules cancelAt = currentPeriodEnd ?? now
POST /api/v1/workspaces/:workspaceId/billing/reactivate            clears a pending cancellation — may return { checkoutUrl } directly (unchanged, see paystack-integration.md §3)

POST /api/v1/webhooks/paystack   Sprint 10 — public, inbound, signature-verified (see paystack-integration.md §9)
```

Full request/response schemas are in Swagger at `/api/v1/docs`.

## 12. Known limitations

- **`DevelopmentBillingProvider` remains the default** — a real
  provider (Paystack) requires `BILLING_PROVIDER=paystack` and real
  credentials to be configured; see paystack-integration.md §16 for env
  vars and rollout order.
- **Missing `PlanLimit` configuration fails open** (treated as
  unlimited), not closed — see §4.
- **No proration.** Every plan change on a real provider is a fresh
  checkout, applied immediately once confirmed — see
  paystack-integration.md §13.
- **Platform default currency is NGN** (Sprint 18B §1) — a column-level
  default (`Plan.currency`/`Subscription.currency`/`Invoice.currency`
  all `@default("NGN")`) exists only as a defense-in-depth fallback; the
  real resolution mechanism is `CurrencySettings`/`CurrencyResolutionService`
  (currency.md), unchanged in shape, only reseeded to default to NGN
  instead of USD. Re-running the seed against an already-configured
  production database never overwrites an admin's chosen settings — see
  `seedCurrencySettings`'s deliberate `update: {}`.
- **No PDF receipts.** "Download Receipt" produces a plain-text file
  client-side — see §10. Building real PDF generation was out of scope
  for this sprint.
- **`MONTHLY_CLICKS` is display-only.** It is tracked and shown on the
  usage dashboard but never blocks a redirect or a click from being
  recorded, by design (§1).
- **Billing periods are a day-based approximation** for
  `DevelopmentBillingProvider`/trials only (`addDays(now, 30)` or `365`)
  — a real Paystack subscription uses the period Paystack itself reports
  (`next_payment_date`).
- **Multi-currency pricing** (Sprint 16) — `Plan.currency`/`priceAmount`
  remain a plan's base price; additional per-currency prices,
  IP-based currency detection, user currency preference, and the
  payment-provider currency-capability check all live in
  `docs/architecture/currency.md`, integrated into this same
  `BillingProvider`/`SubscriptionsService` architecture rather than a
  second billing system. Annual pricing per currency remains an open
  product decision, not invented.
- **A `PENDING` invoice never auto-expires** (Sprint 18A) — an abandoned
  checkout stays `PENDING` indefinitely, always retriable, with no
  background job to time it out. This is a deliberate simplification,
  not an oversight — see paystack-integration.md §13.
