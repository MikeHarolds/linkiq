import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { PlansService } from '../../plans.service';
import type {
  BillingProvider,
  BillingWebhookEvent,
  CheckoutSessionResult,
  CreateCheckoutSessionInput,
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
  ) {}

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    const plan = await this.plans.getBySlug(input.planSlug);
    if (!plan.providerPlanId) {
      // Deliberately not silently falling back to a one-off, non-recurring
      // charge — see §4/§12 of the plan: only plans with a real Paystack
      // plan_code configured are purchasable through automated checkout.
      throw new BadRequestException(
        `Plan "${plan.slug}" is not configured for automated checkout yet (no Paystack plan code set).`,
      );
    }

    const reference = generatePaystackReference();
    const callbackUrl =
      input.successUrl ?? `${DEFAULT_APP_URL}/dashboard/billing/callback`;

    const result = await this.api.initializeTransaction({
      email: input.email,
      amountKobo: plan.priceAmount,
      reference,
      planCode: plan.providerPlanId,
      callbackUrl,
      metadata: { workspaceId: input.workspaceId, planSlug: plan.slug },
    });

    this.logger.debug(
      `Checkout initialized for workspace ${input.workspaceId}, plan ${plan.slug}, reference ${reference}`,
    );

    return { devFlow: false, checkoutUrl: result.authorizationUrl };
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
}
