import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PlansService } from '../../plans.service';
import type {
  BillingProvider,
  BillingWebhookEvent,
  CheckoutSessionResult,
  CreateCheckoutSessionInput,
  CreateProviderPlanInput,
  CreateProviderPlanResult,
  ProviderSubscriptionSnapshot,
  VerifyTransactionResult,
} from '../billing-provider.interface';

import { PaystackApiClient } from './paystack-api.client';
import { generatePaystackReference } from './paystack-reference';

const DEFAULT_APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

/** Packs Paystack's `subscription_code` + `email_token` (both required
 * to disable a subscription) into the single `providerSubscriptionId`
 * column Subscription already has — no dedicated column for the token
 * exists (see docs/architecture/paystack-integration.md §5, which
 * deliberately keeps the migration to four fields). Not a hash or an
 * opaque ID on Paystack's side, so splitting on the first `:` is safe:
 * neither component contains one (Paystack's own generated codes are
 * alphanumeric/underscore). */
export function packSubscriptionId(
  subscriptionCode: string,
  emailToken: string,
): string {
  return `${subscriptionCode}:${emailToken}`;
}

export function unpackSubscriptionId(providerSubscriptionId: string): {
  subscriptionCode: string;
  emailToken: string;
} {
  const separatorIndex = providerSubscriptionId.indexOf(':');
  if (separatorIndex === -1) {
    throw new Error(
      `Malformed Paystack providerSubscriptionId (expected "code:token"): ${providerSubscriptionId}`,
    );
  }
  return {
    subscriptionCode: providerSubscriptionId.slice(0, separatorIndex),
    emailToken: providerSubscriptionId.slice(separatorIndex + 1),
  };
}

/**
 * The first real BillingProvider implementation. Every method here
 * only talks to Paystack via PaystackApiClient and never touches
 * Prisma directly — SubscriptionsService and the webhook processor own
 * all persistence, keeping this class a pure adapter the same way
 * DevelopmentBillingProvider is a pure no-op.
 */
@Injectable()
export class PaystackBillingProvider implements BillingProvider {
  private readonly logger = new Logger(PaystackBillingProvider.name);

  constructor(
    private readonly api: PaystackApiClient,
    private readonly plans: PlansService,
    private readonly config: ConfigService,
  ) {}

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    const plan = await this.plans.getBySlug(input.planSlug);

    // Sprint 16 — a currency other than the plan's base currency
    // resolves to its own PlanPrice row (and that row's OWN Paystack
    // plan_code, since a Paystack Plan object is single-currency — see
    // docs/architecture/currency.md). No currencyCode, or a currencyCode
    // matching the base currency, keeps pre-Sprint-16 behavior exactly.
    let amountKobo = plan.priceAmount;
    let providerPlanId = plan.providerPlanId;
    let currencyCode = plan.currency;

    if (input.currencyCode && input.currencyCode !== plan.currency) {
      const price = plan.prices.find(
        (p) => p.currency.code === input.currencyCode,
      );
      if (!price) {
        throw new BadRequestException(
          `Plan "${plan.slug}" has no price configured for ${input.currencyCode}.`,
        );
      }
      amountKobo = price.amount;
      providerPlanId = price.providerPlanId;
      currencyCode = input.currencyCode;
    }

    if (!providerPlanId) {
      // Deliberately not silently falling back to a one-off, non-recurring
      // charge — see §4/§12 of the plan: only plans with a real Paystack
      // plan_code configured are purchasable through automated checkout.
      throw new BadRequestException(
        `Plan "${plan.slug}" is not configured for automated checkout in ${currencyCode} yet (no Paystack plan code set).`,
      );
    }

    const reference = generatePaystackReference();
    const callbackUrl =
      input.successUrl ?? `${DEFAULT_APP_URL}/dashboard/billing/callback`;

    const result = await this.api.initializeTransaction({
      email: input.email,
      amountKobo,
      reference,
      planCode: providerPlanId,
      callbackUrl,
      metadata: {
        workspaceId: input.workspaceId,
        planSlug: plan.slug,
        currency: currencyCode,
      },
    });

    this.logger.debug(
      `Checkout initialized for workspace ${input.workspaceId}, plan ${plan.slug}, currency ${currencyCode}, reference ${reference}`,
    );

    return { devFlow: false, checkoutUrl: result.authorizationUrl };
  }

  /** Sprint 16 §11 — an explicit, operator-configured allowlist (see
   * paystack.config.ts) — never a fabricated "yes" for a currency this
   * merchant account can't actually process. */
  getSupportedCurrencies(): string[] {
    return (
      this.config.get<string[]>('paystack.supportedCurrencies') ?? [
        'NGN',
        'USD',
      ]
    );
  }

  /** Sprint 17 §6 — surfaced to the checkout confirmation UI so it can
   * show "Paystack" as the (currently only) real gateway rather than a
   * hardcoded frontend string. */
  getProviderName(): string {
    return 'paystack';
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    const { subscriptionCode, emailToken } = unpackSubscriptionId(
      providerSubscriptionId,
    );
    await this.api.disableSubscription(subscriptionCode, emailToken);
  }

  async changeSubscription(): Promise<void> {
    // No confirmed Paystack primitive for an in-place plan swap/proration
    // (§4, §13 of the plan) — callers must start a fresh checkout via
    // createCheckoutSession instead and let the webhook-driven state
    // machine disable the superseded subscription once the new one is
    // confirmed active. SubscriptionsService's real-provider branch never
    // calls this method; it exists only to satisfy the interface.
    throw new Error(
      'PaystackBillingProvider does not support in-place subscription changes — start a fresh checkout via createCheckoutSession instead.',
    );
  }

  async getSubscription(
    providerSubscriptionId: string,
  ): Promise<ProviderSubscriptionSnapshot | null> {
    const { subscriptionCode } = unpackSubscriptionId(providerSubscriptionId);
    const snapshot = await this.api.getSubscription(subscriptionCode);
    if (!snapshot) {
      return null;
    }
    return {
      providerSubscriptionId,
      status: snapshot.status,
      currentPeriodEnd: snapshot.nextPaymentDate,
    };
  }

  /**
   * NOT the inbound webhook receiver — see PaystackWebhookController,
   * which does raw-body HMAC verification and BillingEventsService
   * idempotency recording. This method exists only to satisfy the
   * BillingProvider interface for symmetry with DevelopmentBillingProvider;
   * Paystack's webhook shape doesn't fit "verify signature and return one
   * parsed event" as a provider-agnostic operation the way this method
   * implies (there's no per-request secret to look up — it's a single
   * static account key), so the real receiver bypasses this entirely and
   * calls PaystackSignatureService directly.
   */
  async handleWebhook(): Promise<BillingWebhookEvent> {
    throw new Error(
      'PaystackBillingProvider.handleWebhook is unused — inbound webhooks are handled by PaystackWebhookController/PaystackSignatureService directly.',
    );
  }

  async verifyTransaction(reference: string): Promise<VerifyTransactionResult> {
    const result = await this.api.verifyTransaction(reference);
    return {
      success: result.status === 'success',
      reference: result.reference,
    };
  }

  /**
   * Sprint 14 — the first caller of PaystackApiClient.createPlan(),
   * which existed since Sprint 10 but was never wired through the
   * BillingProvider abstraction until now (see admin-plans.controller.ts
   * / plans.service.ts's create() for the call site). Real Paystack API
   * call, not a simulation — a successful result means a plan genuinely
   * now exists in Paystack's dashboard under this plan_code.
   */
  async createProviderPlan(
    input: CreateProviderPlanInput,
  ): Promise<CreateProviderPlanResult> {
    const result = await this.api.createPlan({
      name: input.name,
      amountKobo: input.priceAmount,
      interval: input.billingInterval === 'ANNUAL' ? 'annually' : 'monthly',
      currency: input.currency,
    });
    return { providerPlanId: result.planCode };
  }
}
