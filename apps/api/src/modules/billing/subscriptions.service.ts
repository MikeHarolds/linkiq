import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PlanTier,
  Prisma,
  SubscriptionStatus,
  WebhookEventType,
  type Invoice,
  type Subscription,
} from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import {
  paginationMeta,
  type PaginatedResult,
} from '../../common/dto/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoleResolutionService } from '../roles/role-resolution.service';
import { WebhookEventsService } from '../webhooks/webhook-events.service';

import { InvoicesService } from './invoices.service';
import { PlansService, type PlanWithLimits } from './plans.service';
import {
  BILLING_PROVIDER,
  type BillingProvider,
} from './providers/billing-provider.interface';
import { getEffectiveStatus } from './utils/effective-status';

export type SubscriptionWithPlan = Subscription & { plan: PlanWithLimits };

/** Returned by subscribe/changePlan/reactivate instead of a bare
 * SubscriptionWithPlan (Sprint 10) — `checkoutUrl` is non-null exactly
 * when a real provider requires the user's browser to complete payment
 * before anything changes. When it's set, `subscription` is the
 * *unchanged* current subscription (nothing is applied yet — the
 * inbound webhook is what actually activates it once payment is
 * confirmed; see PaystackBillingProvider/docs/architecture/
 * paystack-integration.md). When it's null, `subscription` already
 * reflects the applied change, exactly as these methods behaved before
 * Sprint 10. */
export interface SubscriptionMutationResult {
  subscription: SubscriptionWithPlan;
  checkoutUrl: string | null;
  /** Sprint 18A — set instead of checkoutUrl when a paid plan change
   * requires payment and a real payment provider is configured: a
   * PENDING Invoice was created for the user to review, and nothing
   * about the subscription itself has changed yet (`subscription`
   * above is still the *unchanged* current one). The frontend shows an
   * invoice-review screen and calls proceedToPayment with this
   * invoice's id to actually initialize the Paystack checkout — see
   * confirmAndActivate's docs for what happens after payment. Null in
   * every other case (no payment required, or dev-flow apply). */
  invoice: Invoice | null;
}

export interface ConfirmAndActivateInput {
  /** The provider's own transaction/checkout reference — how this
   * input correlates back to a LinkIQ Invoice (see
   * InvoicesService.findByProviderReference / attachProviderReference). */
  reference: string;
  /** The provider's raw status string (Paystack: "success", "failed",
   * "abandoned", ...) — only "success" can ever lead to activation. */
  status: string;
  amountKobo: number;
  currency: string | null;
  customerCode: string | null;
  /** Echoed transaction metadata — used for the invoiceId/workspaceId
   * fallback-correlation and cross-check described on confirmAndActivate. */
  metadata: Record<string, unknown> | null;
}

export interface ConfirmAndActivateResult {
  /** Null when no LinkIQ Invoice could be correlated to this reference
   * at all — a legacy/orphaned transaction that never went through the
   * invoice-first flow (see confirmAndActivate's docs). Callers must
   * fall back to their own legacy handling in that case. */
  invoice: Invoice | null;
  subscription: SubscriptionWithPlan | null;
  /** True only the one time this reference actually caused a state
   * transition. False for every idempotent repeat call (duplicate
   * webhook/callback delivery) — see confirmAndActivate's docs. */
  applied: boolean;
}

export type SubscriptionWithPlanAndWorkspace = SubscriptionWithPlan & {
  workspace: {
    id: string;
    name: string;
    slug: string;
    organization: {
      name: string;
      owner: { id: string; email: string; firstName: string; lastName: string };
    };
  };
};

export interface ListSubscriptionsQuery {
  page: number;
  pageSize: number;
  status?: SubscriptionStatus;
  planSlug?: string;
  /** Matches against workspace name/slug (case-insensitive). */
  search?: string;
}

const SUBSCRIPTION_WITH_PLAN_INCLUDE = {
  plan: {
    include: {
      limits: true,
      platformRole: { select: { id: true, name: true, slug: true } },
      prices: { include: { currency: true } },
    },
  },
} as const;

/** Day-based billing-period approximation (30 days / 365 days) rather
 * than exact calendar-month arithmetic — a deliberate simplification for
 * this foundation sprint (no real provider drives the actual renewal
 * date yet); a real provider integration would replace this with
 * whatever period it reports back via getSubscription()/webhooks. */
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    @Inject(forwardRef(() => WebhookEventsService))
    private readonly webhookEvents: WebhookEventsService,
    private readonly roleResolution: RoleResolutionService,
    private readonly currencies: CurrencyService,
    private readonly invoices: InvoicesService,
  ) {}

  private get pastDueGraceDays(): number {
    return this.config.get<number>('paystack.pastDueGraceDays') ?? 7;
  }

  /** Sprint 18A — the currently configured gateway's machine name, or
   * null when none is configured (DevelopmentBillingProvider). Reuses
   * the exact idiom Sprint 17 §6 already established for "is a real
   * gateway configured" (BillingController.activeProvider) — this is
   * also the fork point between "apply directly" (dev mode, or no
   * payment required) and "go through the invoice-first flow" (a real
   * provider, payment required). */
  private get realProviderName(): string | null {
    return this.provider.getProviderName?.() ?? null;
  }

  /**
   * Sprint 16 §11 — resolves which currency/amount a subscribe/
   * changePlan call should actually use, in the exact required order:
   * currency exists -> currency active -> plan has a valid price for it.
   * Provider-support (step 4) is deliberately NOT checked here — it's
   * only relevant on the path that actually reaches the provider (a
   * TRIALING subscribe never does), see assertProviderSupportsCurrency.
   * Undefined `requestedCode` means "use the plan's own base currency,"
   * preserving every pre-Sprint-16 call site's behavior exactly.
   */
  private async resolvePlanPrice(
    plan: PlanWithLimits,
    requestedCode: string | undefined,
  ): Promise<{ code: string; amount: number }> {
    const code = requestedCode ?? plan.currency;
    const currency = await this.currencies.getByCodeOrThrow(code);
    if (!currency.isActive) {
      throw new BadRequestException(
        `Currency "${code}" is not currently available`,
      );
    }
    if (code === plan.currency) {
      return { code, amount: plan.priceAmount };
    }
    const price = plan.prices.find((p) => p.currency.code === code);
    if (!price) {
      throw new BadRequestException(
        `Plan "${plan.slug}" has no price configured for ${code}`,
      );
    }
    return { code, amount: price.amount };
  }

  /** Sprint 16 §11 step 4 — never assumes an active LinkIQ currency is
   * automatically processable by the configured payment provider. A
   * provider that omits getSupportedCurrencies (DevelopmentBillingProvider)
   * is treated as supporting everything, since nothing is ever actually
   * charged in dev mode. */
  private assertProviderSupportsCurrency(code: string): void {
    const supported = this.provider.getSupportedCurrencies?.();
    if (supported && !supported.includes(code)) {
      // Sprint 18B §16 — the one gate a currency must clear to reach
      // checkout at all now that checkout is amount/currency-driven,
      // not plan-code-driven (§17): is this currency in the configured
      // provider's own allowlist. Worded for a customer to read
      // directly, not just an admin/API consumer.
      throw new BadRequestException(
        `Payment in ${code} is not currently available. Please select another currency.`,
      );
    }
  }

  /**
   * Sprint 17 §5 — the single decision point for "does moving this
   * workspace to `plan` at `resolvedAmount` require real payment right
   * now," used identically by subscribe() and changePlan() so the two
   * entry points can never disagree. An upgrade (resolvedAmount higher
   * than what the workspace is currently paying — `currentAmount`, the
   * Subscription's own immutable Sprint 16 `amount`, never the plan's
   * live price) always requires payment UNLESS this is the workspace's
   * first-ever trial on a plan that offers one (`trialUsed` — see that
   * field's own schema docs for why `trialStart` alone can't answer
   * this). A downgrade or lateral move (resolvedAmount <= currentAmount)
   * never requires payment — see applyDowngradeIfNeeded for what happens
   * to an existing real provider subscription in that case.
   */
  private determinePaymentRequirement(
    existing: Pick<Subscription, 'amount' | 'trialUsed'> | null,
    plan: PlanWithLimits,
    resolvedAmount: number,
  ): { isUpgrade: boolean; trialEligible: boolean; requiresPayment: boolean } {
    const currentAmount = existing?.amount ?? 0;
    const isUpgrade = resolvedAmount > currentAmount;
    const trialEligible =
      isUpgrade &&
      resolvedAmount > 0 &&
      plan.trialDays != null &&
      plan.trialDays > 0 &&
      !(existing?.trialUsed ?? false);
    return {
      isUpgrade,
      trialEligible,
      requiresPayment: isUpgrade && !trialEligible,
    };
  }

  /** Sprint 17 §5 — a real downgrade (moving to a cheaper resolved
   * amount) away from an already-confirmed Paystack subscription must
   * stop the OLD recurring charge, since Paystack has no proration
   * primitive to adjust it in place (see paystack-integration.md §13).
   * Immediate, no-charge downgrade — a deliberate, documented
   * simplification over a scheduled-at-renewal downgrade (which would
   * need a new scheduling mechanism this sprint doesn't add); the
   * workspace keeps the LOWER tier's access right away and is never
   * billed the old, higher amount again. Returns the provider fields to
   * clear, or an empty object when there's nothing to cancel. */
  private async applyDowngradeIfNeeded(
    existing: Pick<Subscription, 'providerSubscriptionId' | 'amount'> | null,
    resolvedAmount: number,
  ): Promise<
    Partial<
      Record<'provider' | 'providerSubscriptionId' | 'providerPriceId', null>
    >
  > {
    if (
      !existing?.providerSubscriptionId ||
      resolvedAmount >= existing.amount
    ) {
      return {};
    }
    await this.provider.cancelSubscription(existing.providerSubscriptionId);
    return {
      provider: null,
      providerSubscriptionId: null,
      providerPriceId: null,
    };
  }

  /**
   * Re-resolves platformRole (Sprint 15) for every OWNER of this
   * workspace after a subscription mutation — never the acting `userId`
   * directly, since subscribe/changePlan/cancel/reactivate are reachable
   * by a workspace ADMIN, not just its OWNER (see @Roles(ADMIN) on
   * BillingController), and platformRole is derived from *ownership*,
   * not membership (see RoleResolutionService's docs). Safe to call
   * unconditionally after every mutation, including ones that don't
   * change the effective plan (e.g. a cancel() that only sets a future
   * cancelAt) — RoleResolutionService itself decides whether anything
   * actually changed via getEffectiveStatus, and syncStoredRole() is a
   * no-op when the resolved role already matches what's stored.
   */
  private async syncOwnerRoles(
    workspaceId: string,
    ctx?: RequestContext,
  ): Promise<void> {
    const owners = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, role: 'OWNER' },
      select: { userId: true },
    });
    await Promise.all(
      owners.map((o) => this.roleResolution.syncStoredRole(o.userId, ctx)),
    );
  }

  private async getUserEmail(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    return user.email;
  }

  /**
   * Creates the FREE subscription every workspace must have. Takes the
   * transaction client so it can run *inside* the existing
   * workspace-creation transactions (AuthService.register,
   * WorkspacesService.create) — a workspace can never exist without a
   * subscription, even under a crash mid-request, because both rows
   * commit atomically together.
   */
  async createDefaultSubscription(
    tx: Prisma.TransactionClient,
    workspaceId: string,
  ): Promise<void> {
    const freePlan = await tx.plan.findFirst({
      where: { tier: PlanTier.FREE },
      orderBy: { displayOrder: 'asc' },
    });
    if (!freePlan) {
      // Only reachable if the database was never seeded — fail loudly
      // rather than silently letting a workspace exist without any plan,
      // which BillingUsageService is not designed to assume.
      throw new Error(
        'No FREE plan is configured — run the seed script before creating workspaces',
      );
    }

    await tx.subscription.create({
      data: {
        workspaceId,
        planId: freePlan.id,
        status: SubscriptionStatus.ACTIVE,
        currency: freePlan.currency,
        amount: freePlan.priceAmount,
      },
    });
  }

  async getForWorkspace(
    workspaceId: string,
  ): Promise<SubscriptionWithPlan | null> {
    return this.prisma.subscription.findUnique({
      where: { workspaceId },
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });
  }

  /**
   * Sprint 18A, step 3 of the invoice-first flow — the explicit
   * "Proceed to Payment" action taken from the invoice-review screen.
   * Loads the PENDING invoice scoped to its owning workspace (never
   * acts on another workspace's invoice), initializes a real Paystack
   * transaction using the invoice's OWN stored currency/amount — never
   * a caller-supplied value, so a frontend currency can never override
   * the backend-resolved invoice currency (Part 11) — and attaches the
   * resulting reference so confirmAndActivate can find its way back
   * here. Safe to call repeatedly against the same still-PENDING
   * invoice (Part 9/14 test #13, "retry of pending invoice works"):
   * each call simply starts a fresh Paystack transaction and
   * overwrites the previous (abandoned) reference.
   */
  async proceedToPayment(
    workspaceId: string,
    userId: string,
    invoiceId: string,
    ctx: RequestContext,
  ): Promise<{ checkoutUrl: string }> {
    const invoice = await this.invoices.findPendingByIdForWorkspace(
      workspaceId,
      invoiceId,
    );
    if (!invoice || !invoice.targetPlanId) {
      throw new NotFoundException(
        'No pending invoice found for this workspace',
      );
    }
    const plan = await this.plans.getByIdOrThrow(invoice.targetPlanId);

    this.assertProviderSupportsCurrency(invoice.currency);
    const email = await this.getUserEmail(userId);
    const session = await this.provider.createCheckoutSession({
      workspaceId,
      planSlug: plan.slug,
      email,
      currencyCode: invoice.currency,
      // Sprint 18B §17 — the invoice's own stored amount, never
      // re-derived from the plan's current price catalog. This is what
      // Paystack actually charges (see PaystackBillingProvider
      // .createCheckoutSession's own docs on why it no longer reads
      // any plan_code at all).
      amountMinorUnits: invoice.amount,
      invoiceId: invoice.id,
    });

    if (session.devFlow || !session.checkoutUrl) {
      // PENDING invoices are only ever created when a real provider is
      // configured (see subscribe/changePlan above) — reaching here
      // would mean the provider was swapped out from under an
      // in-flight invoice, not a normal user path.
      throw new BadRequestException(
        'No payment provider is configured to process this invoice',
      );
    }

    if (session.reference) {
      await this.invoices.attachProviderReference(
        invoice.id,
        session.reference,
      );
    }

    await this.audit.record({
      action: 'billing.checkout_initiated',
      entity: 'Invoice',
      entityId: invoice.id,
      userId,
      workspaceId,
      metadata: {
        planSlug: plan.slug,
        amount: invoice.amount,
        currency: invoice.currency,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return { checkoutUrl: session.checkoutUrl };
  }

  /**
   * Sprint 18A, steps 5-7 — the ONE function both the checkout-callback
   * route (BillingController.checkoutCallback) and the inbound
   * Paystack webhook (PaystackWebhookProcessor.handleChargeSuccess)
   * call to independently verify a transaction and, only on success,
   * activate the target subscription. Whichever fires first performs
   * the real state transition; the other is a guaranteed no-op — an
   * invoice already PAID or FAILED is terminal and is never
   * re-processed (no re-audit, no re-role-sync, no re-activation),
   * which is a stricter, more literal reading of "must not... assign
   * the role repeatedly" than merely relying on
   * RoleResolutionService.syncStoredRole's own no-op-when-unchanged
   * behavior (Sprint 15) — though that natural idempotency still
   * exists as defense-in-depth.
   *
   * Verification checklist (Part 6) before ever marking PAID: the
   * transaction's own reported status is "success", its amount matches
   * the invoice's own stored amount exactly, its currency matches the
   * invoice's own stored currency exactly (a null/absent provider
   * currency is treated as non-conflicting, since not every caller can
   * supply one), and — where the caller has it — the workspace implied
   * by the transaction's metadata matches the invoice's own workspace.
   * A failed check marks the invoice FAILED rather than activating on
   * a mismatched/tampered value; a FAILED invoice is terminal (a retry
   * goes through a fresh plan selection instead — see
   * InvoicesService.markFailed's docs).
   *
   * Correlation: looks the reference up directly first (set by
   * proceedToPayment's attachProviderReference); if that misses, falls
   * back to an explicit `metadata.invoiceId` (attaching the reference
   * then, for a caller — the webhook — that reaches this before
   * proceedToPayment's own attach call would have). Returns
   * `invoice: null` when neither correlates to anything — a legacy or
   * orphaned transaction that never went through the invoice-first
   * flow at all (e.g. a Paystack-initiated recurring-cycle charge, or
   * an older/test webhook payload) — callers fall back to their own
   * legacy handling in that case, never treating it as an error.
   */
  async confirmAndActivate(
    input: ConfirmAndActivateInput,
    ctx?: RequestContext,
  ): Promise<ConfirmAndActivateResult> {
    const providerName = this.realProviderName ?? 'paystack';

    let invoice = await this.invoices.findByProviderReference(
      providerName,
      input.reference,
    );

    if (!invoice) {
      const invoiceId =
        typeof input.metadata?.invoiceId === 'string'
          ? input.metadata.invoiceId
          : undefined;
      if (invoiceId) {
        const byId = await this.invoices.findByIdForWorkspace(
          typeof input.metadata?.workspaceId === 'string'
            ? input.metadata.workspaceId
            : '',
          invoiceId,
        );
        invoice =
          byId && byId.status === 'PENDING'
            ? await this.invoices.attachProviderReference(
                byId.id,
                input.reference,
              )
            : byId;
      }
    }

    if (!invoice) {
      return { invoice: null, subscription: null, applied: false };
    }

    if (invoice.status === 'PAID' || invoice.status === 'FAILED') {
      const subscription = await this.getForWorkspace(invoice.workspaceId);
      return { invoice, subscription, applied: false };
    }

    const workspaceMatches =
      typeof input.metadata?.workspaceId !== 'string' ||
      input.metadata.workspaceId === invoice.workspaceId;
    const verified =
      input.status === 'success' &&
      input.amountKobo === invoice.amount &&
      (!input.currency || input.currency === invoice.currency) &&
      workspaceMatches;

    if (!verified) {
      const failed = await this.invoices.markFailed(
        invoice.id,
        input.status !== 'success'
          ? `Payment provider reported status "${input.status}"`
          : 'Payment verification failed — amount, currency, or workspace did not match the invoice',
      );
      await this.audit.record({
        action: 'billing.payment_failed',
        entity: 'Invoice',
        entityId: invoice.id,
        workspaceId: invoice.workspaceId,
        metadata: { reference: input.reference, providerStatus: input.status },
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      });
      const subscription = await this.getForWorkspace(invoice.workspaceId);
      return { invoice: failed, subscription, applied: true };
    }

    if (!invoice.targetPlanId) {
      throw new Error(
        `Invoice ${invoice.id} verified successfully but has no targetPlanId to activate`,
      );
    }
    const plan = await this.plans.getByIdOrThrow(invoice.targetPlanId);
    const existing = await this.getForWorkspace(invoice.workspaceId);
    const now = new Date();
    const periodDays = plan.billingInterval === 'ANNUAL' ? 365 : 30;

    const subscription = await this.prisma.subscription.update({
      where: { workspaceId: invoice.workspaceId },
      data: {
        planId: plan.id,
        status: SubscriptionStatus.ACTIVE,
        provider: providerName,
        providerCustomerId:
          input.customerCode ?? existing?.providerCustomerId ?? null,
        currentPeriodStart: now,
        currentPeriodEnd: addDays(now, periodDays),
        pastDueSince: null,
        cancelAt: null,
        canceledAt: null,
        trialStart: null,
        trialEnd: null,
        trialUsed: existing?.trialUsed ?? false,
        currency: invoice.currency,
        amount: invoice.amount,
      },
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });

    const paidInvoice = await this.invoices.markPaid(invoice.id, now, {
      start: now,
      end: addDays(now, periodDays),
    });

    await this.audit.record({
      action: 'billing.payment_succeeded',
      entity: 'Subscription',
      entityId: subscription.id,
      workspaceId: invoice.workspaceId,
      metadata: {
        planSlug: plan.slug,
        invoiceId: invoice.id,
        reference: input.reference,
      },
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    });

    // Sprint 10's precedent: a fresh, real-provider FIRST paid
    // conversion (moving off the FREE default, amount 0) emits
    // SUBSCRIPTION_CREATED — subscribe()/changePlan() deliberately
    // never emit anything for the real-provider path, since nothing
    // was applied until now. Any other paid transition (an already-paid
    // workspace upgrading/downgrading again) emits SUBSCRIPTION_PLAN_CHANGED,
    // matching changePlan()'s own direct-apply emit.
    const isFirstPaidConversion = (existing?.amount ?? 0) === 0;
    await this.webhookEvents.emit(
      isFirstPaidConversion
        ? {
            type: WebhookEventType.SUBSCRIPTION_CREATED,
            workspaceId: invoice.workspaceId,
            resourceId: subscription.id,
            data: {
              id: subscription.id,
              planSlug: plan.slug,
              status: subscription.status,
              trialing: false,
            },
          }
        : {
            type: WebhookEventType.SUBSCRIPTION_PLAN_CHANGED,
            workspaceId: invoice.workspaceId,
            resourceId: subscription.id,
            data: {
              id: subscription.id,
              fromPlanSlug: existing?.plan.slug ?? null,
              toPlanSlug: plan.slug,
              status: subscription.status,
            },
          },
    );

    await this.syncOwnerRoles(invoice.workspaceId, ctx);

    return { invoice: paidInvoice, subscription, applied: true };
  }

  /**
   * Fast-path UX check for the page the user's browser lands on after a
   * redirect-based checkout — kept for any caller that only wants a
   * read-only status peek without server-side re-verification (e.g. a
   * frontend polling loop). The checkout-callback ROUTE itself no
   * longer calls this alone — see BillingController.checkoutCallback,
   * which calls confirmAndActivate for the real, verification-gated
   * activation and only falls back to this shape for its response.
   */
  async verifyCheckout(
    workspaceId: string,
    reference: string,
  ): Promise<{ success: boolean; subscription: SubscriptionWithPlan | null }> {
    const result = await this.provider.verifyTransaction(reference);
    const subscription = await this.getForWorkspace(workspaceId);
    return { success: result.success, subscription };
  }

  /**
   * Resolves the plan a workspace's limits/access should actually be
   * evaluated against right now: the subscribed plan while effectively on
   * it (ACTIVE/TRIALING/PAST_DUE), otherwise the FREE plan — covering a
   * canceled/expired/paused subscription AND a workspace with no
   * subscription row at all (e.g. never backfilled). Never throws for a
   * missing subscription; only BillingUsageService/callers decide what
   * "no subscription" should mean to the caller.
   */
  async getEffectivePlan(workspaceId: string): Promise<{
    subscription: SubscriptionWithPlan | null;
    effectiveStatus: SubscriptionStatus | null;
    plan: PlanWithLimits;
  }> {
    const subscription = await this.getForWorkspace(workspaceId);
    if (!subscription) {
      return {
        subscription: null,
        effectiveStatus: null,
        plan: await this.plans.getFreePlan(),
      };
    }

    const effectiveStatus = getEffectiveStatus(
      subscription,
      new Date(),
      this.pastDueGraceDays,
    );
    const isOnPlan =
      effectiveStatus === SubscriptionStatus.ACTIVE ||
      effectiveStatus === SubscriptionStatus.TRIALING ||
      effectiveStatus === SubscriptionStatus.PAST_DUE;

    return {
      subscription,
      effectiveStatus,
      plan: isOnPlan ? subscription.plan : await this.plans.getFreePlan(),
    };
  }

  /**
   * Establishes a subscribe intent within LinkIQ's own billing domain.
   * Sprint 17 §5 — whether this applies immediately or requires a real
   * checkout is decided by determinePaymentRequirement() against the
   * WORKSPACE's own current amount (0 for the seeded FREE default),
   * never merely "does plan.trialDays exist": a workspace only ever
   * gets ONE free trial, ever (see Subscription.trialUsed). With no
   * real payment provider configured (BillingProvider.
   * createCheckoutSession's devFlow:true), payment-required moves still
   * apply directly rather than redirecting anywhere, exactly as before
   * Sprint 10 — see SubscriptionMutationResult's docs and §7/§8 of
   * docs/architecture/paystack-integration.md.
   */
  async subscribe(
    workspaceId: string,
    userId: string,
    planSlug: string,
    ctx: RequestContext,
    currencyCode?: string,
  ): Promise<SubscriptionMutationResult> {
    const plan = await this.plans.getBySlug(planSlug);
    if (!plan.isActive) {
      throw new BadRequestException('This plan is not currently available');
    }

    const existing = await this.getForWorkspace(workspaceId);
    const resolvedPrice = await this.resolvePlanPrice(plan, currencyCode);
    const { trialEligible, requiresPayment } = this.determinePaymentRequirement(
      existing,
      plan,
      resolvedPrice.amount,
    );

    if (requiresPayment) {
      this.assertProviderSupportsCurrency(resolvedPrice.code);
      const providerName = this.realProviderName;
      if (providerName) {
        if (!existing) {
          throw new NotFoundException(
            'No subscription found for this workspace',
          );
        }
        // Sprint 18A — a paid move with a real provider configured
        // NEVER applies here or calls the provider directly anymore.
        // It creates a PENDING invoice for review; the subscription
        // stays exactly as it is until proceedToPayment + a verified
        // payment (confirmAndActivate) activate it.
        const invoice = await this.invoices.createOrReusePendingInvoice({
          workspaceId,
          subscriptionId: existing.id,
          targetPlanId: plan.id,
          amount: resolvedPrice.amount,
          currency: resolvedPrice.code,
          provider: providerName,
        });
        await this.audit.record({
          action: 'billing.invoice_created',
          entity: 'Invoice',
          entityId: invoice.id,
          userId,
          workspaceId,
          metadata: {
            planSlug: plan.slug,
            amount: invoice.amount,
            currency: invoice.currency,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
        return { subscription: existing, checkoutUrl: null, invoice };
      }
    }

    const now = new Date();
    const periodDays = plan.billingInterval === 'ANNUAL' ? 365 : 30;
    const downgradeProviderFields = await this.applyDowngradeIfNeeded(
      existing,
      resolvedPrice.amount,
    );

    const data = {
      planId: plan.id,
      status: trialEligible
        ? SubscriptionStatus.TRIALING
        : SubscriptionStatus.ACTIVE,
      currentPeriodStart: now,
      currentPeriodEnd: addDays(now, periodDays),
      trialStart: trialEligible ? now : null,
      trialEnd: trialEligible ? addDays(now, plan.trialDays!) : null,
      trialUsed: (existing?.trialUsed ?? false) || trialEligible,
      cancelAt: null,
      canceledAt: null,
      currency: resolvedPrice.code,
      amount: resolvedPrice.amount,
      ...downgradeProviderFields,
    };

    const subscription = await this.prisma.subscription.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });

    await this.audit.record({
      action: 'subscription.created',
      entity: 'Subscription',
      entityId: subscription.id,
      userId,
      workspaceId,
      metadata: { planSlug: plan.slug, trialing: trialEligible },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    if (trialEligible) {
      await this.audit.record({
        action: 'billing.trial_started',
        entity: 'Subscription',
        entityId: subscription.id,
        userId,
        workspaceId,
        metadata: { planSlug: plan.slug, trialDays: plan.trialDays },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }

    await this.webhookEvents.emit({
      type: WebhookEventType.SUBSCRIPTION_CREATED,
      workspaceId,
      resourceId: subscription.id,
      data: {
        id: subscription.id,
        planSlug: plan.slug,
        status: subscription.status,
        trialing: trialEligible,
      },
    });

    await this.syncOwnerRoles(workspaceId, ctx);
    return { subscription, checkoutUrl: null, invoice: null };
  }

  /**
   * Upgrades/downgrades the current plan — Sprint 17 §5's central
   * correction. Previously this only required checkout when the
   * EXISTING subscription already had a confirmed
   * `providerSubscriptionId`, which meant a workspace's very first
   * paid conversion (moving off the seeded FREE default, which never
   * has one) always applied instantly with no payment at all, and
   * conversely a real downgrade FROM a paid plan re-charged the
   * customer for the cheaper plan. determinePaymentRequirement() fixes
   * both: the decision is now "is the new plan's resolved price higher
   * than what this workspace is actually paying today"
   * (`existing.amount`, Sprint 16's immutable snapshot — never the
   * plan's live price), independent of whether a provider subscription
   * happens to exist yet. An upgrade needs a fresh checkout — no
   * Paystack primitive exists for an in-place swap (see
   * PaystackBillingProvider.changeSubscription's docs and §13 of
   * docs/architecture/paystack-integration.md: no proration, applied
   * once the new checkout confirms via webhook, the old subscription
   * is left alone until then). A downgrade/lateral move never charges
   * — see applyDowngradeIfNeeded for what happens to an existing real
   * subscription being downgraded away from.
   */
  async changePlan(
    workspaceId: string,
    userId: string,
    planSlug: string,
    ctx: RequestContext,
    currencyCode?: string,
  ): Promise<SubscriptionMutationResult> {
    const existing = await this.getForWorkspace(workspaceId);
    if (!existing) {
      throw new NotFoundException('No subscription found for this workspace');
    }
    const plan = await this.plans.getBySlug(planSlug);
    if (!plan.isActive) {
      throw new BadRequestException('This plan is not currently available');
    }
    const resolvedPrice = await this.resolvePlanPrice(plan, currencyCode);
    const { trialEligible, requiresPayment } = this.determinePaymentRequirement(
      existing,
      plan,
      resolvedPrice.amount,
    );

    if (requiresPayment) {
      this.assertProviderSupportsCurrency(resolvedPrice.code);
      const providerName = this.realProviderName;
      if (providerName) {
        // Sprint 18A — see subscribe()'s matching branch: create a
        // PENDING invoice for review rather than calling the provider
        // directly. Nothing about `existing` is touched here.
        const invoice = await this.invoices.createOrReusePendingInvoice({
          workspaceId,
          subscriptionId: existing.id,
          targetPlanId: plan.id,
          amount: resolvedPrice.amount,
          currency: resolvedPrice.code,
          provider: providerName,
        });
        await this.audit.record({
          action: 'billing.invoice_created',
          entity: 'Invoice',
          entityId: invoice.id,
          userId,
          workspaceId,
          metadata: {
            fromPlanSlug: existing.plan.slug,
            toPlanSlug: plan.slug,
            amount: invoice.amount,
            currency: invoice.currency,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
        return { subscription: existing, checkoutUrl: null, invoice };
      }
    }

    const now = new Date();
    const downgradeProviderFields = await this.applyDowngradeIfNeeded(
      existing,
      resolvedPrice.amount,
    );

    const subscription = await this.prisma.subscription.update({
      where: { workspaceId },
      data: {
        planId: plan.id,
        status: trialEligible
          ? SubscriptionStatus.TRIALING
          : SubscriptionStatus.ACTIVE,
        trialStart: trialEligible ? now : null,
        trialEnd: trialEligible ? addDays(now, plan.trialDays!) : null,
        trialUsed: existing.trialUsed || trialEligible,
        cancelAt: null,
        canceledAt: null,
        currency: resolvedPrice.code,
        amount: resolvedPrice.amount,
        ...downgradeProviderFields,
      },
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });

    await this.audit.record({
      action: 'billing.plan_changed',
      entity: 'Subscription',
      entityId: subscription.id,
      userId,
      workspaceId,
      metadata: {
        from: existing.plan.slug,
        to: plan.slug,
        trialing: trialEligible,
        downgraded: Object.keys(downgradeProviderFields).length > 0,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.SUBSCRIPTION_PLAN_CHANGED,
      workspaceId,
      resourceId: subscription.id,
      data: {
        id: subscription.id,
        fromPlanSlug: existing.plan.slug,
        toPlanSlug: plan.slug,
        status: subscription.status,
      },
    });

    await this.syncOwnerRoles(workspaceId, ctx);
    return { subscription, checkoutUrl: null, invoice: null };
  }

  /** Schedules cancellation for the end of the current billing period —
   * access continues normally until then (see getEffectiveStatus). */
  async cancel(
    workspaceId: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<SubscriptionWithPlan> {
    const existing = await this.getForWorkspace(workspaceId);
    if (!existing) {
      throw new NotFoundException('No subscription found for this workspace');
    }
    if (
      getEffectiveStatus(existing, new Date(), this.pastDueGraceDays) ===
      SubscriptionStatus.CANCELED
    ) {
      throw new BadRequestException('This subscription is already canceled');
    }

    if (existing.providerSubscriptionId) {
      await this.provider.cancelSubscription(existing.providerSubscriptionId);
    }

    const cancelAt = existing.currentPeriodEnd ?? new Date();
    const subscription = await this.prisma.subscription.update({
      where: { workspaceId },
      data: { cancelAt, canceledAt: new Date() },
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });

    await this.audit.record({
      action: 'subscription.canceled',
      entity: 'Subscription',
      entityId: subscription.id,
      userId,
      workspaceId,
      metadata: { cancelAt: cancelAt.toISOString() },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.SUBSCRIPTION_CANCELED,
      workspaceId,
      resourceId: subscription.id,
      data: { id: subscription.id, cancelAt: cancelAt.toISOString() },
    });

    // A no-op today (cancelAt is in the future, so getEffectiveStatus
    // still reports the subscription as effectively active) — called
    // anyway for the day cancelAt is set to "now" or already past, and
    // to keep this method's behavior consistent with subscribe/
    // changePlan/reactivate rather than being the one mutation that
    // silently skips role resolution.
    await this.syncOwnerRoles(workspaceId, ctx);
    return subscription;
  }

  /**
   * Reverses a pending (not-yet-effective) cancellation. When the
   * canceled subscription was backed by a real provider subscription,
   * that subscription was already disabled at cancel()-time (Paystack has
   * no "undo a disable" primitive) — silently clearing cancelAt here
   * would leave LinkIQ granting access with no real subscription behind
   * it, so this instead routes through a fresh checkout, same as an
   * upgrade (see PaystackBillingProvider.cancelSubscription's docs).
   * DevelopmentBillingProvider subscriptions never have a
   * providerSubscriptionId, so this branch never triggers in dev mode —
   * identical to pre-Sprint-10 behavior.
   */
  async reactivate(
    workspaceId: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<SubscriptionMutationResult> {
    const existing = await this.getForWorkspace(workspaceId);
    if (!existing) {
      throw new NotFoundException('No subscription found for this workspace');
    }
    if (!existing.cancelAt) {
      throw new BadRequestException(
        'There is no pending cancellation to reverse',
      );
    }
    if (existing.cancelAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'This subscription has already been canceled — subscribe again to resume',
      );
    }

    if (existing.providerSubscriptionId) {
      // Reactivating resumes THIS subscription — it must never silently
      // switch currency (Sprint 16 §12), so the fresh checkout reuses
      // whatever currency this subscription already recorded rather
      // than accepting a caller-supplied one.
      this.assertProviderSupportsCurrency(existing.currency);
      const email = await this.getUserEmail(userId);
      const session = await this.provider.createCheckoutSession({
        workspaceId,
        planSlug: existing.plan.slug,
        email,
        currencyCode: existing.currency,
        // Sprint 18B §17 — the subscription's own immutable snapshot
        // amount (Sprint 16 §12), matching the currency it already
        // reuses above — never re-derived from the plan's current
        // price catalog.
        amountMinorUnits: existing.amount,
      });
      if (!session.devFlow) {
        await this.audit.record({
          action: 'billing.checkout_initiated',
          entity: 'Subscription',
          entityId: existing.id,
          userId,
          workspaceId,
          metadata: { planSlug: existing.plan.slug, reactivating: true },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
        return {
          subscription: existing,
          checkoutUrl: session.checkoutUrl ?? null,
          invoice: null,
        };
      }
    }

    const subscription = await this.prisma.subscription.update({
      where: { workspaceId },
      data: { cancelAt: null, canceledAt: null },
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });

    await this.audit.record({
      action: 'subscription.reactivated',
      entity: 'Subscription',
      entityId: subscription.id,
      userId,
      workspaceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.SUBSCRIPTION_REACTIVATED,
      workspaceId,
      resourceId: subscription.id,
      data: { id: subscription.id, status: subscription.status },
    });

    await this.syncOwnerRoles(workspaceId, ctx);
    return { subscription, checkoutUrl: null, invoice: null };
  }

  /**
   * Platform-wide subscription list (Sprint 11 — Super Admin). Every
   * mutation this admin surface offers (change-plan/cancel/reactivate)
   * reuses the exact methods above with the admin's own userId as the
   * acting user — never a parallel write path, so the BillingProvider
   * abstraction (and therefore Paystack) is never bypassed.
   */
  async listAllForAdmin(
    query: ListSubscriptionsQuery,
  ): Promise<PaginatedResult<SubscriptionWithPlanAndWorkspace>> {
    const searchTerm = query.search?.trim();
    const where: Prisma.SubscriptionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.planSlug ? { plan: { slug: query.planSlug } } : {}),
      ...(searchTerm
        ? {
            workspace: {
              OR: [
                { name: { contains: searchTerm, mode: 'insensitive' } },
                { slug: { contains: searchTerm, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const include = {
      plan: {
        include: {
          limits: true,
          platformRole: { select: { id: true, name: true, slug: true } },
          prices: { include: { currency: true } },
        },
      },
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          organization: {
            select: {
              name: true,
              owner: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      },
    } as const;

    const [items, totalItems] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.subscription.count({ where }),
    ]);

    return {
      items,
      pagination: paginationMeta(query.page, query.pageSize, totalItems),
    };
  }

  /**
   * Extends (or shortens) a currently-trialing subscription's trial end
   * date — the one subscription mutation with no pre-Sprint-11
   * equivalent. Deliberately restricted to subscriptions actually in
   * TRIALING: extending a non-trial subscription's `trialEnd` would be
   * meaningless (getEffectiveStatus only reads trialEnd when
   * status === TRIALING), so rejecting early avoids silently doing
   * nothing. Never touches the provider — trials are LinkIQ-only
   * regardless of BILLING_PROVIDER (see paystack-integration.md §2), so
   * there is nothing to reconcile with Paystack here.
   */
  async extendTrial(
    workspaceId: string,
    newTrialEnd: Date,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<SubscriptionWithPlan> {
    const existing = await this.getForWorkspace(workspaceId);
    if (!existing) {
      throw new NotFoundException('No subscription found for this workspace');
    }
    if (existing.status !== SubscriptionStatus.TRIALING) {
      throw new BadRequestException(
        'Only a currently-trialing subscription can have its trial extended',
      );
    }

    const subscription = await this.prisma.subscription.update({
      where: { workspaceId },
      data: { trialEnd: newTrialEnd },
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });

    await this.audit.record({
      action: 'admin.trial_extended',
      entity: 'Subscription',
      entityId: subscription.id,
      userId: adminUserId,
      workspaceId,
      metadata: {
        previousTrialEnd: existing.trialEnd?.toISOString() ?? null,
        newTrialEnd: newTrialEnd.toISOString(),
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return subscription;
  }
}
