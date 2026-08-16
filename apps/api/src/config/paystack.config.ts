import { registerAs } from '@nestjs/config';

export default registerAs('paystack', () => ({
  /**
   * Server-only — used both for authenticating outbound API calls
   * (Authorization: Bearer) AND for verifying inbound webhook signatures
   * (Paystack has no separate webhook-signing secret; the signature is
   * HMAC'd with this same key — see security/paystack-signature.service.ts).
   * Test vs. live mode is inferred from this key's own prefix
   * (sk_test_/sk_live_), not a separate flag — see
   * providers/paystack-billing.provider.ts.
   */
  secretKey: process.env.PAYSTACK_SECRET_KEY ?? '',

  /** Safe to expose client-side. Unused server-side by the redirect-based
   * checkout this sprint ships (see docs/architecture/paystack-integration.md
   * §Checkout UX) — kept for a future inline-checkout option. */
  publicKey: process.env.PAYSTACK_PUBLIC_KEY ?? '',

  /**
   * How long a subscription may stay PAST_DUE (a failed recurring charge
   * Paystack will never itself retry) before getEffectiveStatus() derives
   * EXPIRED — see effective-status.ts.
   */
  pastDueGraceDays: Number(process.env.PAYSTACK_PAST_DUE_GRACE_DAYS ?? 7),

  /** Paystack's own base API origin — not expected to ever change, but
   * kept configurable rather than hardcoded inline in the HTTP client. */
  apiBaseUrl: process.env.PAYSTACK_API_BASE_URL ?? 'https://api.paystack.co',

  /**
   * Sprint 16 — which ISO 4217 currencies the configured Paystack
   * merchant account can actually process (a single account bills in
   * one base currency, with USD addable alongside it for NG/KE
   * accounts — see docs/architecture/paystack-integration.md §2). No
   * confirmed "list supported currencies" API endpoint exists, so this
   * is an explicit, operator-configured allowlist rather than a guess —
   * see PaystackBillingProvider.getSupportedCurrencies. Defaults to the
   * realistic NG-account setup this project's research already
   * documented.
   */
  supportedCurrencies: (process.env.PAYSTACK_SUPPORTED_CURRENCIES ?? 'NGN,USD')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean),
}));
