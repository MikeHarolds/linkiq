import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PlanTier,
  Prisma,
  SubscriptionStatus,
  WebhookEventType,
  type Subscription,
} from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookEventsService } from '../webhooks/webhook-events.service';

import { PlansService, type PlanWithLimits } from './plans.service';
import {
  BILLING_PROVIDER,
  type BillingProvider,
} from './providers/billing-provider.interface';
import { getEffectiveStatus } from './utils/effective-status';

export type SubscriptionWithPlan = Subscription & { plan: PlanWithLimits };

const SUBSCRIPTION_WITH_PLAN_INCLUDE = {
  plan: { include: { limits: true } },
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
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    @Inject(forwardRef(() => WebhookEventsService))
    private readonly webhookEvents: WebhookEventsService,
  ) {}

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

    const effectiveStatus = getEffectiveStatus(subscription);
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
   * Establishes a subscribe intent within LinkIQ's own billing domain —
   * see BillingProvider.createCheckoutSession's docs: with no real
   * payment provider configured, this applies directly rather than
   * redirecting anywhere. Idempotent-ish: calling it again just updates
   * the one-per-workspace Subscription row.
   */
  async subscribe(
    workspaceId: string,
    userId: string,
    planSlug: string,
    ctx: RequestContext,
  ): Promise<SubscriptionWithPlan> {
    const plan = await this.plans.getBySlug(planSlug);
    if (!plan.isActive) {
      throw new BadRequestException('This plan is not currently available');
    }

    await this.provider.createCheckoutSession({ workspaceId, planSlug });

    const now = new Date();
    const isTrialing = plan.trialDays != null && plan.trialDays > 0;
    const periodDays = plan.billingInterval === 'ANNUAL' ? 365 : 30;

    const data = {
      planId: plan.id,
      status: isTrialing ? SubscriptionStatus.TRIALING : SubscriptionStatus.ACTIVE,
      currentPeriodStart: now,
      currentPeriodEnd: addDays(now, periodDays),
      trialStart: isTrialing ? now : null,
      trialEnd: isTrialing ? addDays(now, plan.trialDays!) : null,
      cancelAt: null,
      canceledAt: null,
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

    return subscription;
  }

  async changePlan(
    workspaceId: string,
    userId: string,
    planSlug: string,
    ctx: RequestContext,
  ): Promise<SubscriptionWithPlan> {
    const existing = await this.getForWorkspace(workspaceId);
    if (!existing) {
      throw new NotFoundException('No subscription found for this workspace');
    }
    const plan = await this.plans.getBySlug(planSlug);
    if (!plan.isActive) {
      throw new BadRequestException('This plan is not currently available');
    }

    if (existing.providerSubscriptionId) {
      await this.provider.changeSubscription(
        existing.providerSubscriptionId,
        plan.slug,
      );
    }

    const subscription = await this.prisma.subscription.update({
      where: { workspaceId },
      data: {
        planId: plan.id,
        status: SubscriptionStatus.ACTIVE,
        cancelAt: null,
        canceledAt: null,
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

    return subscription;
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
    if (getEffectiveStatus(existing) === SubscriptionStatus.CANCELED) {
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

    return subscription;
  }

  /** Reverses a pending (not-yet-effective) cancellation. */
  async reactivate(
    workspaceId: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<SubscriptionWithPlan> {
    const existing = await this.getForWorkspace(workspaceId);
    if (!existing) {
      throw new NotFoundException('No subscription found for this workspace');
    }
    if (!existing.cancelAt) {
      throw new BadRequestException('There is no pending cancellation to reverse');
    }
    if (existing.cancelAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'This subscription has already been canceled — subscribe again to resume',
      );
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

    return subscription;
  }
}
