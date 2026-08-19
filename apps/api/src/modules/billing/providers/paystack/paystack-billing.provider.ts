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
import { PaystackApiException } from './paystack-api.exception';
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

  /**
   * Sprint 18B §17 — amount/currency-authoritative, never plan-code-
   * driven. Before this sprint, a real checkout passed Paystack's own
   * `plan` (plan_code) field alongside `amount`; Paystack's documented
   * behavior is that a `plan` present on `/transaction/initialize`
   * makes the PLAN's own stored price win, silently ignoring `amount`.
   * That is precisely the bug a live verification exposed: a plan_code
   * created once, early on, drifts out of sync with LinkIQ's own
   * Plan/Invoice price the moment either side is edited afterward, with
   * nothing to catch it until a real transaction reports a mismatched
   * amount/currency. This method now NEVER sends `plan` — every
   * checkout is a plain, one-time transaction for exactly
   * `input.amountMinorUnits`/`input.currencyCode`, which
   * `SubscriptionsService.proceedToPayment` always populates straight
   * from the originating Invoice's own stored amount/currency (the
   * single source of truth — see docs/architecture/paystack-
   * integration.md §17). `Plan.providerPlanId`/`PlanPrice
   * .providerPlanId` are no longer read here at all — kept as DB
   * columns only for backward-compat/informational display (Sprint 10
   * era plans that were never migrated), never a checkout requirement.
   */
  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CheckoutSessionResult> {
    const plan = await this.plans.getBySlug(input.planSlug);
    const currencyCode = input.currencyCode ?? plan.currency;

    const reference = generatePaystackReference();
    const callbackUrl =
      input.successUrl ?? `${DEFAULT_APP_URL}/dashboard/billing/callback`;

    let result;
    try {
      result = await this.api.initializeTransaction({
        email: input.email,
        amountKobo: input.amountMinorUnits,
        currency: currencyCode,
        reference,
        callbackUrl,
        metadata: {
          workspaceId: input.workspaceId,
          planSlug: plan.slug,
          currency: currencyCode,
          // Sprint 18A — present whenever the caller has already created
          // a LinkIQ Invoice for this checkout (the invoice-first flow).
          // Absent for any older/other caller — the webhook processor
          // falls back to workspaceId+planSlug correlation in that case.
          ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
        },
      });
    } catch (error) {
      // Sprint 18B §16 — getSupportedCurrencies() (above) is a static,
      // operator-configured allowlist; it cannot know which currencies
      // the LIVE Paystack merchant account actually has enabled (found
      // during Sprint 18B's own live verification: a real TEST-mode
      // account rejected a USD transaction with HTTP 403 "Currency not
      // supported by merchant" even though USD was in the allowlist).
      // Without this catch, that 403 propagated as an uncaught
      // PaystackApiException — an unhandled 500 the customer never gets
      // a real explanation for. Translate any Paystack-reported 403 here
      // into the same friendly, actionable message
      // assertProviderSupportsCurrency already uses for the static-
      // allowlist case, so both paths read identically from the UI.
      if (error instanceof PaystackApiException && error.status === 403) {
        this.logger.warn(
          `Paystack rejected checkout currency ${currencyCode} for workspace ${input.workspaceId}: ${error.message}`,
        );
        throw new BadRequestException(
          `Payment in ${currencyCode} is not currently available. Please select another currency.`,
        );
      }
      throw error;
    }

    this.logger.debug(
      `Checkout initialized for workspace ${input.workspaceId}, plan ${plan.slug}, amount ${input.amountMinorUnits} ${currencyCode}, reference ${reference}`,
    );

    return {
      devFlow: false,
      checkoutUrl: result.authorizationUrl,
      reference,
    };
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
      amountKobo: result.amountKobo,
      currency: result.currency,
      customerCode: result.customerCode,
      metadata: result.metadata,
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
