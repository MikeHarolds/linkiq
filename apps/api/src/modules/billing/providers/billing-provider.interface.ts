/** DI token — see billing.module.ts for which implementation is bound to
 * it (chosen via BILLING_PROVIDER). */
export const BILLING_PROVIDER = 'BILLING_PROVIDER';

export interface CreateCheckoutSessionInput {
  workspaceId: string;
  planSlug: string;
  /** The payer's email — required by every real payment provider to
   * create a customer/checkout session. Unused by
   * DevelopmentBillingProvider. */
  email: string;
  /** Sprint 16 — which currency to check out in. Undefined = use the
   * plan's own base currency. Callers (SubscriptionsService) are
   * responsible for having already confirmed the currency is active
   * AND provider-supported before reaching here; a provider
   * implementation may still reject a currency it cannot process. */
  currencyCode?: string;
  /** Sprint 18B §16/§17 — the EXACT amount (smallest currency unit) to
   * charge, always caller-supplied and never re-derived from the
   * Plan/PlanPrice catalog at checkout-initialization time. For the
   * invoice-first flow (proceedToPayment) this is always
   * `invoice.amount` — the one and only authoritative source, immune
   * to a plan price edit landing between invoice creation and payment.
   * Required for a real provider; ignored by DevelopmentBillingProvider
   * (dev-flow never calls out to anything). */
  amountMinorUnits: number;
  successUrl?: string;
  cancelUrl?: string;
  /** Sprint 18A — the LinkIQ Invoice this checkout is for, embedded
   * into the provider-side transaction metadata so the webhook/
   * callback can correlate unambiguously (see
   * PaystackWebhookProcessor.handleChargeSuccess) rather than relying
   * solely on workspaceId+planSlug matching, which is ambiguous once a
   * workspace can have more than one PENDING invoice for different
   * target plans at once. Optional and unused by
   * DevelopmentBillingProvider. */
  invoiceId?: string;
}

export interface CheckoutSessionResult {
  /** True when no real payment provider is configured — the caller
   * applies the subscription change directly against LinkIQ's own
   * database instead of redirecting anywhere. A real provider's
   * implementation would set this false and populate checkoutUrl. */
  devFlow: boolean;
  checkoutUrl?: string;
  /** Sprint 18A — the provider's own transaction/checkout reference
   * (Paystack: the `reference` returned by initialize-transaction).
   * Absent when devFlow is true. The caller (SubscriptionsService)
   * attaches this to the originating Invoice via
   * InvoicesService.attachProviderReference so later verification can
   * find its way back to the right invoice. */
  reference?: string;
}

export interface ProviderSubscriptionSnapshot {
  providerSubscriptionId: string;
  status: string;
  currentPeriodEnd: Date | null;
}

export interface BillingWebhookEvent {
  externalEventId: string;
  eventType: string;
  payload: unknown;
}

export interface CreateProviderPlanInput {
  name: string;
  /** Smallest currency unit (cents/kobo/etc.) — same convention as
   * Plan.priceAmount, never a decimal major-unit value. */
  priceAmount: number;
  currency: string;
  billingInterval: 'MONTHLY' | 'ANNUAL';
}

export interface CreateProviderPlanResult {
  providerPlanId: string;
}

export interface VerifyTransactionResult {
  /** True when the provider confirms this transaction/checkout
   * succeeded. */
  success: boolean;
  reference: string;
  /** Sprint 18A — everything the shared confirm-and-activate function
   * (SubscriptionsService.confirmAndActivate) needs to independently
   * verify this transaction against its originating Invoice's own
   * stored amount/currency (Part 6/11) before ever marking it PAID —
   * the checkout-callback route now performs a real, server-side
   * verification here rather than being a read-only fast-path
   * courtesy; it must still never trust these values without this call
   * having actually happened. */
  amountKobo: number;
  currency: string | null;
  customerCode: string | null;
  /** Echoed back from initializeTransaction's metadata — carries
   * invoiceId when the checkout was created via the invoice-first flow
   * (see CreateCheckoutSessionInput.invoiceId), falling back to
   * workspaceId/planSlug correlation when absent. */
  metadata: Record<string, unknown> | null;
}

/**
 * The seam a real payment provider (Stripe, Paddle, Paystack,
 * Flutterwave, ...) plugs into later without any of plans/subscriptions/
 * usage/limits/the billing dashboard needing to change. Every method here
 * is provider-agnostic on purpose — no Stripe-specific naming or shapes.
 *
 * This sprint ships exactly one implementation
 * (DevelopmentBillingProvider) that never calls out to anything; see its
 * own docs for what each method does in the absence of a real provider.
 */
export interface BillingProvider {
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSessionResult>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  changeSubscription(
    providerSubscriptionId: string,
    newProviderPriceId: string,
  ): Promise<void>;
  getSubscription(
    providerSubscriptionId: string,
  ): Promise<ProviderSubscriptionSnapshot | null>;
  handleWebhook(
    rawPayload: Buffer | string,
    signature: string | undefined,
  ): Promise<BillingWebhookEvent>;
  /** Called from the checkout-callback route the user's browser lands
   * on after a redirect-based checkout (see CheckoutSessionResult).
   * Fast-path UX only — see VerifyTransactionResult. */
  verifyTransaction(reference: string): Promise<VerifyTransactionResult>;
  /**
   * Optional (Sprint 14): creates a corresponding plan on the provider
   * side, for providers whose subscriptions are built around a
   * provider-managed plan catalog (Paystack is — see
   * PaystackBillingProvider). Providers that have no such concept
   * (DevelopmentBillingProvider, and any future provider that only
   * needs a price ID at checkout time) simply omit this method —
   * PlansService.create checks for its presence before calling it and
   * never fails plan creation if it's absent or if the call itself
   * fails, since LinkIQ's own Plan row is the thing that must exist
   * either way.
   */
  createProviderPlan?(
    input: CreateProviderPlanInput,
  ): Promise<CreateProviderPlanResult>;
  /**
   * Optional (Sprint 16): which ISO 4217 currency codes this provider
   * can actually process a checkout in, for the CURRENTLY configured
   * merchant account/credentials — distinct from whether a currency is
   * active in LinkIQ's own Currency catalogue (see
   * docs/architecture/currency.md §11: "LinkIQ currency status vs
   * payment provider currency capability"). Providers that omit this
   * method (DevelopmentBillingProvider) are treated as supporting every
   * LinkIQ-active currency, since dev-flow never actually charges
   * anyone. Never fabricates support — PaystackBillingProvider's
   * implementation is a configured allowlist, not a guess.
   */
  getSupportedCurrencies?(): string[];
  /**
   * Optional (Sprint 17): a stable, lowercase machine name for this
   * gateway (e.g. "paystack") — the ONLY thing that drives which
   * gateway option(s) the checkout confirmation UI shows (see
   * BillingController's plan/summary responses and Sprint 17 §6: "the
   * UI should only display gateways that are configured, active, ...
   * do not display fake gateways"). Providers that omit this
   * (DevelopmentBillingProvider) surface as `provider: null` to the
   * frontend, which then applies changes directly with no
   * gateway-selection step at all — there is nothing to select.
   */
  getProviderName?(): string;
}
