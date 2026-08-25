# Email, Verification & Analytics Reporting Architecture

Sprint 20 adds production transactional email: registration verification,
welcome emails, password-reset delivery (plugged into the already-working
reset flow), admin-controlled provider configuration, and user-configurable
daily/weekly analytics report emails. Nothing here duplicates existing
infrastructure — it reuses the same BullMQ queue pattern webhooks already
established, the same AES-256-GCM secret-at-rest cipher, the same
singleton-settings-row pattern branding/currency already use, and the
existing `AnalyticsService` for every number a report email shows.

## 1. Pipeline overview

```
Application (auth, reports, admin) -> EmailService.queueEmail(...)
    -> writes one EmailLog row (QUEUED, or SKIPPED if disabled)
    -> enqueues one BullMQ job ({ emailLogId } only)
  -> EmailDeliveryProcessor (worker, off the request path)
    -> reloads the EmailLog fresh from Postgres
    -> resolves the live EmailProvider (Resend / SMTP / disabled)
    -> renders the template for EmailLog.type from EmailLog.metadata
    -> sends, classifies the outcome, updates the log row
    -> retries (BullMQ-native exponential backoff) or terminates
```

`EmailService.queueEmail` never performs a network call and never throws —
every caller (registration, password reset, report dispatch) completes
regardless of whether the email subsystem is healthy, configured, or even
enabled. This mirrors `WebhookEventsService.emit`'s "write the row, then
enqueue `{id}`" shape exactly; see `docs/architecture/webhooks.md` §1-2 for
the precedent this was built from.

## 2. Provider abstraction

```ts
interface EmailProvider {
  readonly kind: EmailProviderKind | null;
  send(input: EmailSendInput): Promise<EmailSendResult>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}
```

Three implementations, resolved fresh on every send attempt by
`EmailProviderFactory` (never cached across jobs, so an admin toggling
enabled/provider mid-flight is always respected immediately):

- **`ResendEmailProvider`** — HTTPS API only (`POST
https://api.resend.com/emails`), raw `fetch`, no `resend` npm package.
  This is the recommended demo path and the only provider Render Free is
  guaranteed to reach without an SMTP-capable egress.
- **`SmtpEmailProvider`** — wraps `nodemailer` (this sprint's one new
  runtime dependency), supporting TLS/SSL/None encryption modes.
- **`NullEmailProvider`** — the disabled no-op. `EmailProviderFactory`
  resolves to this whenever `EmailConfiguration.enabled` is false, or the
  selected provider is missing required config (e.g. no API key yet) —
  `send()` always returns a clean, non-retryable failure with no network
  call, which is what lets `EmailService`/`EmailDeliveryProcessor` "skip
  gracefully" without special-casing the disabled state anywhere else.

## 3. Database model

```
EmailConfiguration (singleton, fixed id '...0002' — SiteBranding owns '...0001')
  enabled, provider (RESEND|SMTP), fromName, fromEmail
  resendApiKeyPrefix (display-safe) / resendApiKeyCiphertext (AES-256-GCM, never returned)
  smtpHost, smtpPort, smtpUsername, smtpPasswordCiphertext, smtpEncryptionMode
  requireEmailVerification (presentational only — see §5)
  welcomeEmailsEnabled, verificationEmailsEnabled, passwordResetEmailsEnabled,
    reportEmailsEnabled (per-type kill switches, checked in addition to `enabled` —
    see §9's EmailService.queueEmail note; TEST bypasses all four)
  lastSuccessfulSendAt, lastFailedSendAt, lastConnectionTestAt, lastConnectionTestOk

EmailLog
  id, recipientEmail, recipientUserId (nullable — a "Send Test Email" has no User)
  type (VERIFICATION|WELCOME|PASSWORD_RESET|DAILY_REPORT|WEEKLY_REPORT|TEST)
  provider, status (QUEUED|SENDING|SENT|FAILED|SKIPPED)
  attemptCount, lastAttemptAt, sentAt, failureReason
  metadata (Json — template variables only, never a secret)

EmailVerificationToken   -- mirrors PasswordResetToken exactly
  id, userId, tokenHash (sha256, never the raw token), expiresAt, usedAt

UserReportPreference     -- one row per user, lazily created on first read/write
  emailReportsEnabled, frequency (DAILY|WEEKLY), reportDay, reportHourUtc

EmailReportRun           -- idempotency ledger for report dispatch, see §7
  userId, frequency, periodStart, periodEnd, emailLogId
  @@unique([userId, frequency, periodStart])
```

`EmailConfiguration`'s secret columns use the exact `prefix`/`ciphertext`
column-pair convention `WebhookEndpoint` established for its signing
secret — see `docs/architecture/webhooks.md` §5. The cipher itself
(`EmailSecretCipherService`) is byte-for-byte the same AES-256-GCM shape as
`WebhookSecretCipherService`, with its own independent
`EMAIL_SECRET_ENCRYPTION_KEY`.

Two additive migrations — `sprint20_email_infrastructure` (every table
above) and `sprint20_email_type_toggles` (the four per-type kill-switch
columns on `EmailConfiguration`, added after the fact rather than
reshaping the first migration since it had already been applied). No
existing table or column was altered. `User.emailVerified` already
existed and is reused as-is; no new column was added to `User`.

## 4. Retries

Config-driven via `registerAs('email', ...)` (`EMAIL_MAX_ATTEMPTS`,
default 5; `EMAIL_BACKOFF_BASE_MS`, default 2000ms exponential) — the same
mechanism `webhooks.config.ts`/`WebhookDeliveryProducer` already use.
`EmailDeliveryProcessor` classifies each provider's failure as retryable
(429/5xx/timeout/network error) or not (4xx validation, auth failure); a
retryable failure short of the attempt limit `throw`s so BullMQ schedules
the next attempt itself — this codebase never hand-rolls a retry loop.

## 5. Email verification lifecycle

```
Register -> create account -> issue EmailVerificationToken -> queue VERIFICATION email
  -> return successful registration (never blocked on email)
  -> user clicks the link -> POST /auth/verify-email -> token validated -> User.emailVerified = true
```

Tokens are single-use (`usedAt`), expiring (`auth.emailVerification
.tokenExpiresInHours`, default 24h), SHA-256-hashed at rest (never the raw
value), and cannot authenticate the user by themselves — verifying only
flips one boolean, it never issues a session. `POST /auth/resend-verification`
is authenticated (not a public, email-only endpoint) and rate-limited
(3/min), which is a stronger anti-enumeration posture than exposing a
public resend-by-email route; it silently no-ops for an already-verified
account, mirroring `forgotPassword`'s own indistinguishable-outcome
posture.

`EmailConfiguration.requireEmailVerification` (default ON) is
**presentational only** — the dashboard shows a "verify your email"
banner + resend action when `user.emailVerified` is false; it never blocks
login. This keeps seeded demo/admin accounts (already `emailVerified:
true` at seed time) unaffected regardless of the toggle's value.

## 6. Password reset

Unchanged: `forgotPassword`/`resetPassword`'s rate limiting,
anti-enumeration response shape, `PasswordResetToken` model, and
session-invalidation-on-reset all predate this sprint and were not
touched. The only change is `AuthService`'s private
`sendPasswordResetEmail` method, whose own doc comment explicitly invited
this: its dev-mode `console.log` body was replaced with a real
`EmailService.queueEmail(...)` call — same method name, same signature,
same one call site.

## 7. Analytics report scheduling

No cron/scheduling infrastructure of any kind existed anywhere in this
codebase before this sprint (confirmed via exhaustive search). Rather than
adding `@nestjs/schedule` as a second, parallel scheduling mechanism, this
sprint uses BullMQ's own native repeatable-job engine
(`Queue.upsertJobScheduler`) — `bullmq`/`@nestjs/bullmq` were already
installed and wired via `QueueModule`, and `WebhookDeliveryProducer`'s own
doc comment already establishes a "reuse BullMQ's engine, don't hand-roll
a scheduler" philosophy this sprint continues.

Two hourly-cron repeatables (`daily-report-tick`, `weekly-report-tick`)
each invoke `ReportDispatchService.runTick(frequency)`, which:

1. Finds every `UserReportPreference` row due **this UTC hour** (+ the
   matching `reportDay` for weekly).
2. Computes the report period once (`utils/report-period.ts`):
   - **Daily** = yesterday, UTC midnight to UTC midnight.
   - **Weekly** = the prior _complete_ Monday–Sunday UTC week —
     deliberately NOT `AnalyticsQueryDto`'s `range: '7d'`, which includes
     today (a partial day) and would show an incomplete report if sent
     mid-day.
3. Attempts `EmailReportRun.create({ userId, frequency, periodStart, ... })`.
   **This create call succeeding is the entire idempotency mechanism** —
   `EmailReportRun`'s `@@unique([userId, frequency, periodStart])`
   constraint is what actually prevents a double-send on a restart, a
   duplicate tick, or a manual re-run; there is no separate
   application-level "have I already sent this" check. A unique-violation
   is caught and the user is silently skipped for this tick.
4. Only on a successful create: calls `ReportGenerationService
.buildReportData(workspaceId, period)`, which calls `AnalyticsService`
   directly and only (`getOverview`, `getSourceBreakdown`, `getGeography`,
   `getTopLinks`, `getTopCampaigns`, `getTimeseries` for the click-trend
   chart) plus `LinksService.getWorkspaceStats` for the "Active links"
   figure — **zero new aggregation SQL anywhere in this sprint**. The
   click trend uses hourly buckets for the 1-day daily-report period and
   daily buckets for the 7-day weekly-report period. Queues the report
   email, then links `EmailReportRun.emailLogId` back to the sent log.
5. Isolates per-user failures with try/catch — one bad workspace or query
   error never aborts the rest of the batch.

**No timezone field exists anywhere in this schema** (confirmed: neither
`User` nor `Workspace` has one; the dashboard only ever computes an IANA
timezone client-side via `Intl.DateTimeFormat` and sends it as a query
param, never persisting it). Per this sprint's own instruction not to
build new timezone infrastructure for one feature, reports run on a fixed
**UTC** schedule — `UserReportPreference.reportHourUtc` is an hour-of-day,
0-23, UTC, and the settings page shows this explicitly ("Reports are sent
based on UTC time") rather than implying local-time delivery.

A user can belong to multiple workspaces; `UserReportPreference` is
per-user, not per-workspace, so v1 generates one report against the
workspace the user **owns** (falling back to their first membership) —
documented here as a deliberate simplification, not a hidden gap.

## 8. Templates

Plain server-rendered HTML strings (no templating-engine dependency) —
`{{var}}` interpolation is HTML-escaped via `escapeHtml`
(`templates/template-renderer.service.ts`) so a user-controlled value
(e.g. `firstName`) can never inject markup into an outbound email.
`layout.ts` wraps every template body in a shared header/footer using
`BrandingService.get()` for `siteName`/`logoUrl` — `SiteBranding` has no
brand-color field, so the layout picks its own fixed accent color.
Templates: Welcome, Verification, Password Reset, Daily Report, Weekly
Report (the latter two share one body-rendering function — only the
subject line and the caller-supplied period differ), Test Email.

## 9. Security

- Verification and reset tokens: SHA-256 hash only, single-use, expiring,
  cannot authenticate on their own.
- Provider secrets: AES-256-GCM at rest, decrypted only inside
  `EmailProviderFactory` at the moment of sending, never returned by any
  admin GET endpoint (`EmailConfigService.getMasked()` is the only shape
  the admin API ever serializes), never included in audit metadata
  (`EmailConfigService.update()` explicitly redacts `resendApiKey`/
  `smtpPassword` before writing the audit record).
- Rate limiting: `resend-verification` reuses the existing
  `@Throttle`/`ApiKeyAwareThrottlerGuard` mechanism, no new guard wiring.
- Admin email routes: `SuperAdminGuard`, identical to every other
  `/admin/*` controller.
- User report-preference routes: scoped by `CurrentUser()`, no
  workspace header/guard involved — a user can only ever read/write their
  own row.

## 10. Render / demo deployment

Exactly 3 env vars are required for the recommended demo path:
`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`. If all three
are present, `prisma/seed.ts`'s `seedEmailConfiguration()` pre-populates
and **enables** `EmailConfiguration` with them (idempotent — it never
overwrites an already-configured row, so an admin's later change via
`/admin/settings/email` always wins over a subsequent re-seed). Resend's
HTTPS-only transport means this works on Render Free with no outbound SMTP
port required. SMTP remains fully supported as an alternative but is
admin-UI/DB-configured, not env-var-driven.

## 11. Troubleshooting

- **Emails stuck QUEUED**: check the BullMQ worker is running (same
  process as the API — `EmailDeliveryProcessor` is registered in
  `EmailModule`, no separate worker process) and that Redis is reachable.
- **Emails SKIPPED**: either `EmailConfiguration.enabled` is false, or
  that specific type's kill switch (`welcomeEmailsEnabled` /
  `verificationEmailsEnabled` / `passwordResetEmailsEnabled` /
  `reportEmailsEnabled`) is off — `EmailLog.failureReason` says which.
  Check `/admin/settings/email` ("Email types" card) or `GET
/admin/email/config`.
- **Resend send fails immediately**: Resend's sandbox mode only delivers
  to the account owner's own verified address until a sending domain is
  verified — check `lastFailedSendAt`/the `EmailLog.failureReason` for the
  specific rejection.
- **Reports never arrive**: confirm `UserReportPreference
.emailReportsEnabled` is true and `reportHourUtc` matches the _current
  UTC hour_, not local time — see §7.
