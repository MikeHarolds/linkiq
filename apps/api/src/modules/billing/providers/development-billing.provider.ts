import { Injectable, Logger } from '@nestjs/common';

import type {
  BillingProvider,
  BillingWebhookEvent,
  CheckoutSessionResult,
  CreateCheckoutSessionInput,
  ProviderSubscriptionSnapshot,
} from './billing-provider.interface';

/**
 * The only `BillingProvider` implementation this sprint ships. Never
 * makes an external call of any kind — every subscribe/change-plan/
 * cancel/reactivate action in this codebase applies directly to LinkIQ's
 * own `Subscription` row (see SubscriptionsService), and this class exists
 * so those call sites still go through the provider interface exactly the
 * way they would with a real provider, making the eventual swap a new
 * class + one factory branch in billing.module.ts, not a rewrite.
 */
@Injectable()
export class DevelopmentBillingProvider implements BillingProvider {
  private readonly logger = new Logger(DevelopmentBillingProvider.name);

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    this.logger.debug(
      `No payment provider configured — workspace ${input.workspaceId} subscription to "${input.planSlug}" will be applied directly.`,
    );
    return Promise.resolve({ devFlow: true });
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    // Dev/free subscriptions never have a providerSubscriptionId — nothing
    // external to cancel. Logged, not thrown, so callers never need to
    // special-case "no provider" themselves.
    this.logger.debug(
      `No-op: cancelSubscription(${providerSubscriptionId}) — no payment provider configured.`,
    );
    return Promise.resolve();
  }

  async changeSubscription(
    providerSubscriptionId: string,
    newProviderPriceId: string,
  ): Promise<void> {
    this.logger.debug(
      `No-op: changeSubscription(${providerSubscriptionId} -> ${newProviderPriceId}) — no payment provider configured.`,
    );
    return Promise.resolve();
  }

  async getSubscription(
    _providerSubscriptionId: string,
  ): Promise<ProviderSubscriptionSnapshot | null> {
    // No external system to query — the local Subscription row is
    // authoritative for every subscription this sprint can create.
    return Promise.resolve(null);
  }

  async handleWebhook(
    _rawPayload: Buffer | string,
    _signature: string | undefined,
  ): Promise<BillingWebhookEvent> {
    throw new Error(
      'DevelopmentBillingProvider does not receive real webhooks — no payment provider is configured. Implement a real BillingProvider before wiring an inbound webhook route.',
    );
  }
}
