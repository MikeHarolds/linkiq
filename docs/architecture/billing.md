# Billing Architecture

Sprint 7 introduced the billing _foundation_: plans, a per-workspace
subscription, usage tracking, and limit enforcement, with no real payment
provider — every mutation applied directly against LinkIQ's own database.
Sprint 10 crossed that boundary: **Paystack is now a real, optional
`BillingProvider` implementation** (`BILLING_PROVIDER=paystack`), covering
real checkout, real recurring charges, and a real inbound webhook
receiver. `BILLING_PROVIDER=development` (the default) remains completely
unchanged from Sprint 7 — this document describes the domain model shared
by both; see **[paystack-integration.md](./paystack-integration.md)** for
everything specific to the real provider (checkout flow, webhook
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

Invoice        (billing history — see §7)
  id, workspaceId, subscriptionId?, number, amount, currency
  status (DRAFT | OPEN | PAID | VOID | UNCOLLECTIBLE | REFUNDED)
  failureReason   (Sprint 10 — why a charge/cycle failed)
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

`InvoicesService.listForWorkspace` reads; `InvoicesService
.recordProviderInvoice` (Sprint 10) is the one write path, called only by
`PaystackWebhookProcessor` from a confirmed provider event — there is
still no user-facing endpoint that can fabricate a PAID record. No
invoice is ever seeded as "paid" — a workspace's billing history is an
honest empty list until a real payment provider actually processes
something.

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
read-only), and a billing-history table with an honest empty state.
`/dashboard/billing/callback` (Sprint 10) is where the browser lands
after a redirect-based Paystack checkout — see paystack-integration.md
§11. Selecting a plan (or reactivating) redirects the browser to
`checkoutUrl` when a real provider returns one; with no provider
configured, `checkoutUrl` is always null and the change applies
immediately, exactly as in Sprint 7.

## 11. API surface

```
GET  /api/v1/workspaces/:workspaceId/billing                    summary: subscription, effective plan, usage, invoice count
GET  /api/v1/workspaces/:workspaceId/billing/usage               per-feature usage/limit/remaining
GET  /api/v1/workspaces/:workspaceId/billing/plans                all active plans + limits
GET  /api/v1/workspaces/:workspaceId/billing/invoices             billing history (may be empty)
GET  /api/v1/workspaces/:workspaceId/billing/checkout/callback    Sprint 10 — fast-path checkout verification, ?reference=
POST /api/v1/workspaces/:workspaceId/billing/subscribe            { planSlug } — may return { checkoutUrl }
POST /api/v1/workspaces/:workspaceId/billing/change-plan          { planSlug } — may return { checkoutUrl }
POST /api/v1/workspaces/:workspaceId/billing/cancel                schedules cancelAt = currentPeriodEnd ?? now
POST /api/v1/workspaces/:workspaceId/billing/reactivate            clears a pending cancellation — may return { checkoutUrl }

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
