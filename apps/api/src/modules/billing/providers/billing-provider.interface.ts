/** DI token — see billing.module.ts for which implementation is bound to
 * it (chosen via BILLING_PROVIDER). */
export const BILLING_PROVIDER = 'BILLING_PROVIDER';

export interface CreateCheckoutSessionInput {
  workspaceId: string;
  planSlug: string;
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
}
