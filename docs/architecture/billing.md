# Billing Architecture

Sprint 7 introduces the billing _foundation_: plans, a per-workspace
subscription, usage tracking, and limit enforcement. It deliberately does
**not** integrate a real payment provider — no card is ever charged, no
real webhook is ever received. Every mutation (`subscribe`, `change-plan`,
`cancel`, `reactivate`) applies directly against LinkIQ's own database.
This document explains the domain model, the enforcement mechanism, and
exactly where the boundary to a real provider is meant to be crossed
later.

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
  provider, providerCustomerId, providerSubscriptionId, providerPriceId

BillingEvent   (webhook idempotency ledger — see §6)
  id, provider, externalEventId, eventType, status, payload
  @@unique([provider, externalEventId])

Invoice        (read-only billing history — see §7)
  id, workspaceId, subscriptionId?, number, amount, currency, status
  @@unique([workspaceId, number])
```

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
- `cancelAt` set and already passed → `CANCELED`
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
the seam a real payment processor plugs into later — `createCheckoutSession`,
`cancelSubscription`, `changeSubscription`, `getSubscription`,
`handleWebhook` — every method provider-agnostic, no Stripe/Paddle/etc.
naming leaking into the interface. Selected via the `BILLING_PROVIDER` DI
token, factory-chosen in `billing.module.ts` off the `BILLING_PROVIDER`
env var, the same shape as Sprint 6's `DOMAIN_VERIFICATION_PROVIDER`.

This sprint ships exactly one implementation,
`DevelopmentBillingProvider`: every method is a no-op or logs-only;
`createCheckoutSession` returns `{ devFlow: true }` (no real checkout
URL) — which is why `SubscriptionsService.subscribe`/`changePlan` apply
the plan change directly against LinkIQ's own database instead of
redirecting anywhere. A real provider later is a new class implementing
the same interface plus one more branch in the factory — nothing in
`PlansService`, `SubscriptionsService`, `BillingUsageService`, the
controller, or the frontend needs to change.

## 6. Webhook idempotency (ready, not wired up)

`BillingEventsService.recordEvent({ provider, externalEventId, eventType,
payload })` relies on `BillingEvent`'s `@@unique([provider,
externalEventId])` plus the shared `isUniqueConstraintViolation` helper
(`common/utils/prisma-errors.ts`) to make a duplicate delivery a harmless
no-op — it returns the existing row with `isNew: false` instead of
throwing or creating a second record. **No HTTP webhook receiver exists
yet** — there is nothing for a real provider to call, since integrating
one is explicitly out of scope this sprint. The idempotency guarantee is
proven directly by `billing-events.service.spec.ts` (calling `recordEvent`
twice with the same `externalEventId`), ready for a future webhook
controller to depend on.

## 7. Invoices — read-only, nothing fabricated

`InvoicesService.listForWorkspace` is the only method on the service —
there is no write path in the API surface. No invoice is ever seeded as
"paid": the demo workspace's billing history is an honest empty list,
because no real payment has ever occurred in this system. Invoices only
ever get created by a real provider's webhook events, once one exists.

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
read-only), and a billing-history table with an honest empty state. The
page states plainly that no payment provider is connected and no card is
ever charged — see the banner at the top of the dashboard.

## 11. API surface

```
GET  /api/v1/workspaces/:workspaceId/billing            summary: subscription, effective plan, usage, invoice count
GET  /api/v1/workspaces/:workspaceId/billing/usage       per-feature usage/limit/remaining
GET  /api/v1/workspaces/:workspaceId/billing/plans       all active plans + limits
GET  /api/v1/workspaces/:workspaceId/billing/invoices    billing history (may be empty)
POST /api/v1/workspaces/:workspaceId/billing/subscribe   { planSlug }
POST /api/v1/workspaces/:workspaceId/billing/change-plan { planSlug }
POST /api/v1/workspaces/:workspaceId/billing/cancel      schedules cancelAt = currentPeriodEnd ?? now
POST /api/v1/workspaces/:workspaceId/billing/reactivate  clears a pending, not-yet-effective cancellation
```

Full request/response schemas are in Swagger at `/api/v1/docs`.

## 12. Known limitations

- **No real payment provider.** `DevelopmentBillingProvider` is the only
  implementation; every subscribe/change-plan/cancel/reactivate call
  mutates LinkIQ's own database directly and never charges any money.
- **Missing `PlanLimit` configuration fails open** (treated as
  unlimited), not closed — see §4.
- **No proration, real invoicing, tax calculation, or dunning** — all of
  these require a real provider and are out of scope.
- **`MONTHLY_CLICKS` is display-only.** It is tracked and shown on the
  usage dashboard but never blocks a redirect or a click from being
  recorded, by design (§1).
- **Billing periods are a day-based approximation** (`addDays(now, 30)`
  or `365`) rather than real calendar-month/provider-driven billing
  cycles — there is no real provider yet to report an authoritative
  period back.
- **No webhook receiver.** `BillingEventsService`'s idempotency guarantee
  is unit-tested directly; nothing calls it from a live HTTP endpoint
  yet, since there is no real provider to send anything.
