// Runs before any test file's module graph is loaded (Jest's `setupFiles`
// guarantee) — this is what makes DISABLE_RATE_LIMIT_FOR_TESTS visible to
// app.module.ts's conditional provider registration in time. See
// setup-app.ts and rate-limit.e2e-spec.ts for the full explanation.
process.env.DISABLE_RATE_LIMIT_FOR_TESTS = 'true';
