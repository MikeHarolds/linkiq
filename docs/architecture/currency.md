# Currency, Localization & Multi-Currency Payments Architecture

Sprint 16. Introduces a database-backed currency catalogue, country →
currency mapping, currency detection/resolution, per-currency plan
pricing, and an exchange-rate abstraction — all integrated into the
existing billing architecture (Plan/Subscription/Invoice, `BillingProvider`,
Paystack) rather than a second, parallel billing system.

## 1. Data model

- **`Currency`** — the catalogue. `code`/`name`/`symbol`/`numericCode`/
  `decimalPlaces`/`region`/`isActive`. The database is the source of
  truth: nothing in the app hardcodes a currency list, so adding a row
  (Super Admin, `/admin/currencies`) makes a currency available
  platform-wide with no code change. Deliberately has **no**
  `isDefault`/`isFallback` boolean columns — see §2 for why.
- **`CurrencyCountryMapping`** — one row per ISO 3166-1 country code,
  pointing at a `Currency`. Multiple countries share one `Currency` row
  (every XOF country points at the same row) rather than duplicating
  currency records per country.
- **`CurrencySettings`** — an enforced singleton (fixed id, same
  pattern `SiteBranding` uses) holding `defaultCurrencyId`,
  `fallbackCurrencyId`, and `autoDetectEnabled`. Both currency pointers
  are required — the platform can never end up without a valid
  fallback.
- **`PlanPrice`** — a plan's price in a currency other than its base
  `Plan.currency`/`priceAmount` (which are untouched by this sprint —
  every plan seeded before Sprint 16 keeps working exactly as before).
  `@@unique([planId, currencyId])`. Carries its own `providerPlanId`
  (a Paystack Plan object is single-currency, so a plan purchasable in
  N currencies needs N Paystack plan codes) and, when derived via
  `ExchangeRateService`, `isConverted`/`exchangeRate`/`exchangeRateAsOf`.
- **`Subscription.currency`/`amount`** — new. Before this sprint a
  Plan had exactly one currency, so "the subscription's currency" was
  trivially `plan.currency`; once a Plan can carry N `PlanPrice` rows
  that's no longer true. These two columns are a snapshot, set once at
  subscribe/changePlan/charge-confirmation time and never re-derived
  live from `plan` afterwards — an admin editing a plan's price
  catalog must never retroactively change what an existing paying
  subscription is shown as owing (see §6). Backfilled for every
  pre-existing row from its plan's currency/priceAmount in this
  sprint's migration.
- **`Invoice.exchangeRate`/`exchangeRateAsOf`** — new, nullable.
  `Invoice.amount`/`currency` already existed and were already
  immutable per row; these two columns record the rate that produced a
  _converted_ price, purely historical — never recomputed after the
  fact.
- **`User.preferredCurrencyId`** — an authenticated user's explicit,
  persisted currency choice. Null = no preference set yet.

### Why no `isDefault`/`isFallback` on `Currency`

A stored boolean on every currency row risks drifting out of sync
(two rows both marked default). `CurrencySettings.defaultCurrencyId`/
`fallbackCurrencyId` are the single source of truth; the admin API
computes `isDefault`/`isFallback` on read by comparing a currency's id
against the settings singleton, so there is exactly one place that can
ever be wrong.

## 2. Resolution precedence (never reordered)

Implemented once, in `CurrencyResolutionService.resolve()` — every
caller that needs "the applicable currency right now" goes through
here (or the frontend's client-side mirror, see §5):

1. **Explicit** — a currency named in the current request/action.
2. **User preference** — the authenticated caller's `preferredCurrencyId`.
3. **IP/GeoIP detection** — `extractClientIp()` (existing, shared with
   the redirect route and audit logging) → the existing
   `GeoIpProvider`/`GEO_IP_PROVIDER` from Sprint 13 → country →
   `CurrencyCountryMapping` → an active `Currency`.
4. **Platform fallback** — `CurrencySettings.fallbackCurrency`,
   guaranteed to exist and be active.

Never throws for a bad/missing/private/malformed IP, an unknown
country, or a GeoIP failure — every one of those is "no signal,"
falling through to the next step. `autoDetectEnabled: false` skips
step 3 entirely (goes straight to the fallback).

## 3. Why `/public/currencies/detect` cannot see an authenticated user

`@Public()` routes never populate `request.user` in this codebase,
even when a valid Bearer token is attached (`JwtAuthGuard.canActivate`
returns `true` immediately for a public route, before Passport runs —
see `common/guards/jwt-auth.guard.ts`). The currency-detect endpoint is
`@Public()` (it must work for anonymous visitors), so step 2 above
cannot be evaluated server-side for that specific request.

`CurrencyResolutionService.resolve()` itself still accepts an optional
`userId` and correctly implements the full 4-step chain — every
_authenticated, non-public_ caller (checkout, `/users/me/*`) passes it.
The frontend's `CurrencyProvider` (`apps/web/src/providers/
currency-provider.tsx`) is what merges the chain for the public/
anonymous case: it checks `GET /users/me/currency-preference` itself
when signed in, and only falls through to `/public/currencies/detect`
(steps 3–4) otherwise. See that provider's own docs for the full
merge logic.

## 4. Anonymous vs. authenticated persistence

- **Anonymous**: a plain, non-httpOnly cookie (`linkiq_currency`),
  written entirely client-side. No new backend cookie infrastructure
  was introduced — nothing existed to reuse, and a JS-readable cookie
  is sufficient for "remember an anonymous visitor's currency choice,"
  per Sprint 16 §7's own framing ("cookie or equivalent").
- **Authenticated**: `User.preferredCurrencyId`, via `UsersService
.setCurrencyPreference/clearCurrencyPreference` — the ONLY code that
  ever writes that column. `PATCH /users/me/currency-preference` /
  `DELETE /users/me/currency-preference`.

Neither path is ever touched by IP detection — an explicit choice
(cookie or DB) always wins on every subsequent read until changed
again or cleared, matching Sprint 16 §6/§7's explicit "never
auto-override an explicit selection" rule.

## 5. Currency formatting

`formatCurrency(amountMinorUnits, { code, symbol, decimalPlaces })` —
`packages/utils/src/format.ts`, used only by the frontend (the backend
never renders money to a string). Deliberately does **not** use
`Intl.NumberFormat`'s built-in `style: 'currency'` (which looks up its
own symbol/decimal-places from ICU's bundled table): the database is
the source of truth for a currency's symbol/decimalPlaces, so a
currency an admin adds today formats correctly immediately, even for a
code ICU doesn't (yet) recognize. Every caller passes the metadata it
already has from an API response or `CurrencyProvider`'s catalogue —
no component hardcodes a currency list or its own formatting rules.

## 6. Billing integration

### Checkout (Sprint 16 §11's required order)

`SubscriptionsService.resolvePlanPrice()` + `.assertProviderSupportsCurrency()`,
called from `subscribe()`/`changePlan()`:

1. Currency exists (`CurrencyService.getByCodeOrThrow` — 404 otherwise).
2. Currency is active (400 otherwise).
3. The plan has a valid price for it — its own base currency, or a
   matching `PlanPrice` row (400 otherwise).
4. The configured `BillingProvider` supports it — `BillingProvider
.getSupportedCurrencies?()`, an **optional** interface method.
   `DevelopmentBillingProvider` omits it (treated as "supports
   everything," since dev-flow never actually charges anyone).
   `PaystackBillingProvider` returns an explicit, operator-configured
   allowlist (`PAYSTACK_SUPPORTED_CURRENCIES`, default `NGN,USD` — the
   realistic NG-account setup `paystack-integration.md` already
   documented) — never a fabricated "yes."

Only after all four does `createCheckoutSession` run, and only then
does `PaystackBillingProvider.createCheckoutSession` resolve the
currency-specific `PlanPrice` (its own `providerPlanId`/`amount`)
instead of the plan's base fields — fully backward compatible: no
`currencyCode` (or one equal to the plan's base currency) behaves
exactly as every pre-Sprint-16 checkout did.

### Real-charge confirmation

`PaystackWebhookProcessor.handleChargeSuccess` writes
`Subscription.currency`/`amount` straight from the webhook payload's
own `data.currency`/`data.amount` — the same value it already used for
the `Invoice` row, never re-derived from LinkIQ's `Plan`/`PlanPrice`.
This is the authoritative write for a real-provider subscription; the
dev-flow direct-apply path in `subscribe()`/`changePlan()` sets the
same two fields for the no-provider case.

### Reactivation

`reactivate()` reuses `existing.currency` (the subscription's own
already-recorded currency) for the fresh checkout it starts — it never
accepts or infers a new one, so resuming a subscription can never
silently switch currency.

### Preservation (Sprint 16 §12/§13)

Nothing except the four call sites above (`subscribe`, `changePlan`,
`handleChargeSuccess`, the FREE-plan default-subscription creator)
ever writes `Subscription.currency`/`amount`. A user's currency
_preference_ changing has zero effect on any existing subscription —
verified end-to-end in `test/currency.e2e-spec.ts`.

## 7. Exchange rates

`ExchangeRateService` (`getRate`/`convert`) wraps a swappable
`ExchangeRateProvider` — the exact same interface/null-object/DI-token
shape as `GeoIpProvider`/`GEO_IP_PROVIDER` (Sprint 13). The only
binding shipped this sprint is `NullExchangeRateProvider` (always "no
rate available") — not a stub awaiting a follow-up, but the
architecturally correct choice: no external exchange-rate service is
used anywhere else in this project (Sprint 16 §10 explicitly forbids
adding one speculatively). Fixed, admin-typed `PlanPrice` rows work
fully with zero external dependency; the "derive from base price via
exchange rate" option in the admin Plans UI degrades to a clear 400
("no exchange rate is available — set a fixed amount instead") rather
than silently failing or fabricating a rate.

## 8. Authorization & audit

Every `/admin/currencies*` route is `SuperAdminGuard`-protected, same
as every other `/admin/*` controller. Every mutation
(`CurrencyService`/`UsersService.setCurrencyPreference`) is audited
through the existing `AuditService` — no second audit mechanism.
Actions: `admin.currency_created/updated/activated/deactivated/deleted`,
`admin.currency_settings_updated`,
`admin.currency_country_mapping_created/updated/deleted`,
`admin.plan_price_created/updated/removed`,
`user.currency_preference_set/cleared`.

## 9. API surface

- `GET/POST /admin/currencies`, `GET/PATCH/DELETE /admin/currencies/:id`
- `GET/PATCH /admin/currencies/settings`
- `GET/POST /admin/currencies/country-mappings`,
  `PATCH/DELETE /admin/currencies/country-mappings/:id`
- `POST /admin/plans/:planId/prices`,
  `DELETE /admin/plans/:planId/prices/:currencyId`
- `GET /public/currencies`, `GET /public/currencies/detect`
- `GET/PATCH/DELETE /users/me/currency-preference`
- `subscribe`/`change-plan` (`/workspaces/:id/billing/*`) gain an
  optional `currency` field on the existing request body — no new
  routes, matching the existing convention rather than inventing one.

## 10. Known limitations

- No real `ExchangeRateProvider` implementation ships this sprint (see
  §7) — "derive from base price" is architecture-only until one is
  configured.
- Provider currency capability is a static, operator-configured
  allowlist (`PAYSTACK_SUPPORTED_CURRENCIES`) — no confirmed Paystack
  API to query supported currencies for the live account exists (same
  finding `paystack-integration.md` already documented for the base
  currency).
- `CurrencyResolutionService`'s GeoIP binding is a second DI
  registration of the exact same `GeoipCountryProvider` class
  `AnalyticsModule` already uses (not a second implementation) —
  avoiding an `AnalyticsModule → WebhooksModule → BillingModule` import
  cycle that would otherwise reach `CurrencyModule` (which
  `BillingModule` imports). See `currency.module.ts`'s own docs.
