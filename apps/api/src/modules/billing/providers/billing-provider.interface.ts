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
  successUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutSessionResult {
  /** True when no real payment provider is configured — the caller
   * applies the subscription change directly against LinkIQ's own
   * database instead of redirecting anywhere. A real provider's
   * implementation would set this false and populate checkoutUrl. */
  devFlow: boolean;
  checkoutUrl?: string;
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

export interface VerifyTransactionResult {
  /** True when the provider confirms this transaction/checkout
   * succeeded. This is a fast-path UX signal only, used by the
   * checkout-callback route the user's browser lands on after
   * redirect-based checkout — the inbound webhook (handleWebhook,
   * processed asynchronously) remains the source of truth for
   * actually mutating subscription state. Callers must not treat a
   * true result here as license to activate anything themselves. */
  success: boolean;
  reference: string;
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
}
