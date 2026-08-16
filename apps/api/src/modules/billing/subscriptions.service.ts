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
  ) {}

  private get pastDueGraceDays(): number {
    return this.config.get<number>('paystack.pastDueGraceDays') ?? 7;
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
      throw new BadRequestException(`Currency "${code}" is not currently available`);
    }
    if (code === plan.currency) {
      return { code, amount: plan.priceAmount };
    }
    const price = plan.prices.find((p) => p.currency.code === code);
    if (!price) {
      throw new BadRequestException(`Plan "${plan.slug}" has no price configured for ${code}`);
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
      throw new BadRequestException(
        `${code} is not currently supported by the configured payment provider`,
      );
    }
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
  private async syncOwnerRoles(workspaceId: string, ctx: RequestContext): Promise<void> {
    const owners = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, role: 'OWNER' },
      select: { userId: true },
    });
    await Promise.all(owners.map((o) => this.roleResolution.syncStoredRole(o.userId, ctx)));
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
   * Fast-path UX check for the page the user's browser lands on after a
   * redirect-based checkout — see BillingProvider.verifyTransaction's
   * docs. Deliberately read-only: it never mutates the Subscription row
   * itself, even when the provider confirms success. The inbound webhook
   * (processed asynchronously, usually within seconds) remains the sole
   * source of truth for actually activating anything — this only tells
   * the frontend whether the payment itself succeeded, and returns
   * whatever the Subscription row currently says (which may already
   * reflect the webhook's own update if it landed first).
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
   * With no real payment provider configured (BillingProvider.
   * createCheckoutSession's devFlow:true), this applies directly rather
   * than redirecting anywhere — idempotent-ish, calling it again just
   * updates the one-per-workspace Subscription row, exactly as before
   * Sprint 10. With a real provider AND a trial-less plan, this instead
   * returns a checkoutUrl and leaves the Subscription row untouched — see
   * SubscriptionMutationResult's docs and §7/§8 of
   * docs/architecture/paystack-integration.md. Trials remain entirely
   * LinkIQ-side (no provider call at all) regardless of which provider is
   * configured, since Paystack has no trial primitive to hand off to.
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

    const isTrialing = plan.trialDays != null && plan.trialDays > 0;
    const resolvedPrice = await this.resolvePlanPrice(plan, currencyCode);

    if (!isTrialing) {
      this.assertProviderSupportsCurrency(resolvedPrice.code);
      const email = await this.getUserEmail(userId);
      const session = await this.provider.createCheckoutSession({
        workspaceId,
        planSlug,
        email,
        currencyCode: resolvedPrice.code,
      });
      if (!session.devFlow) {
        const current = await this.getForWorkspace(workspaceId);
        if (!current) {
          throw new NotFoundException(
            'No subscription found for this workspace',
          );
        }
        await this.audit.record({
          action: 'billing.checkout_initiated',
          entity: 'Subscription',
          entityId: current.id,
          userId,
          workspaceId,
          metadata: { planSlug: plan.slug },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
        return {
          subscription: current,
          checkoutUrl: session.checkoutUrl ?? null,
        };
      }
    }

    const now = new Date();
    const periodDays = plan.billingInterval === 'ANNUAL' ? 365 : 30;

    const data = {
      planId: plan.id,
      status: isTrialing
        ? SubscriptionStatus.TRIALING
        : SubscriptionStatus.ACTIVE,
      currentPeriodStart: now,
      currentPeriodEnd: addDays(now, periodDays),
      trialStart: isTrialing ? now : null,
      trialEnd: isTrialing ? addDays(now, plan.trialDays!) : null,
      cancelAt: null,
      canceledAt: null,
      currency: resolvedPrice.code,
      amount: resolvedPrice.amount,
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
      metadata: { planSlug: plan.slug, trialing: isTrialing },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    if (isTrialing) {
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
        trialing: isTrialing,
      },
    });

    await this.syncOwnerRoles(workspaceId, ctx);
    return { subscription, checkoutUrl: null };
  }

  /**
   * Upgrades/downgrades the current plan. When the existing subscription
   * is backed by a real, already-confirmed provider subscription
   * (providerSubscriptionId set), this routes through a fresh checkout
   * instead of an in-place swap — no Paystack primitive for that exists
   * (see PaystackBillingProvider.changeSubscription's docs and §13 of
   * docs/architecture/paystack-integration.md: no proration, applied
   * immediately once the new checkout confirms via webhook, the old
   * subscription is left alone until then). DevelopmentBillingProvider
   * subscriptions never have a providerSubscriptionId, so this branch
   * never triggers in dev mode — identical to pre-Sprint-10 behavior.
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

    if (existing.providerSubscriptionId) {
      this.assertProviderSupportsCurrency(resolvedPrice.code);
      const email = await this.getUserEmail(userId);
      const session = await this.provider.createCheckoutSession({
        workspaceId,
        planSlug: plan.slug,
        email,
        currencyCode: resolvedPrice.code,
      });
      if (!session.devFlow) {
        await this.audit.record({
          action: 'billing.checkout_initiated',
          entity: 'Subscription',
          entityId: existing.id,
          userId,
          workspaceId,
          metadata: { fromPlanSlug: existing.plan.slug, toPlanSlug: plan.slug },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
        return {
          subscription: existing,
          checkoutUrl: session.checkoutUrl ?? null,
        };
      }
    }

    const subscription = await this.prisma.subscription.update({
      where: { workspaceId },
      data: {
        planId: plan.id,
        status: SubscriptionStatus.ACTIVE,
        cancelAt: null,
        canceledAt: null,
        currency: resolvedPrice.code,
        amount: resolvedPrice.amount,
      },
      include: SUBSCRIPTION_WITH_PLAN_INCLUDE,
    });

    await this.audit.record({
      action: 'billing.plan_changed',
      entity: 'Subscription',
      entityId: subscription.id,
      userId,
      workspaceId,
      metadata: { from: existing.plan.slug, to: plan.slug },
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
    return { subscription, checkoutUrl: null };
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
    return { subscription, checkoutUrl: null };
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
