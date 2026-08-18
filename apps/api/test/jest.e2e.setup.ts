// Runs before any test file's module graph is loaded (Jest's `setupFiles`
// guarantee) — this is what makes DISABLE_RATE_LIMIT_FOR_TESTS visible to
// app.module.ts's conditional provider registration in time. See
// setup-app.ts and rate-limit.e2e-spec.ts for the full explanation.
process.env.DISABLE_RATE_LIMIT_FOR_TESTS = 'true';

// Sprint 17 — forces the baseline BillingProvider back to 'development'
// for every e2e file, undoing whatever `.env` itself says. Root cause:
// apps/api/.env is a real local-dev file that legitimately sets
// BILLING_PROVIDER=paystack (with real Paystack TEST-mode keys) so a
// developer can manually exercise checkout in the browser — but
// ConfigModule.forRoot() loads that exact same .env for e2e tests too
// (envFilePath: ['.env'], no test-specific override), and dotenv never
// overwrites an already-set process.env value. Before this fix, that
// meant: whichever e2e file's createTestApp() ran FIRST in a given Jest
// worker permanently decided BILLING_PROVIDER for every OTHER file
// sharing that worker for the rest of the run — silently turning
// "plain lifecycle" tests that never intended to touch Paystack into
// tests that could make a real outbound network call (and hang/fail
// unpredictably depending on run order) the moment their scenario
// actually reached a real-provider checkout path. paystack-checkout
// .e2e-spec.ts and currency.e2e-spec.ts already documented "other e2e
// files never set this, so they stay on development" as if it were
// guaranteed — this line is what actually makes that true, by running
// BEFORE each file's own top-level code (setupFiles, per Jest's
// per-file guarantee) so a file that deliberately sets
// `process.env.BILLING_PROVIDER = 'paystack'` at its own top still
// wins for itself, every time, regardless of run order.
process.env.BILLING_PROVIDER = 'development';
