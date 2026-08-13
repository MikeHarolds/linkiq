import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  Ctx,
  type RequestContext,
} from '../../common/decorators/request-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

import { BillingUsageService } from './billing-usage.service';
import { PlanSlugDto } from './dto/plan-slug.dto';
import { InvoicesService } from './invoices.service';
import { PlansService, type PlanWithLimits } from './plans.service';
import {
  SubscriptionsService,
  type SubscriptionMutationResult,
  type SubscriptionWithPlan,
} from './subscriptions.service';
import { getEffectiveStatus } from './utils/effective-status';

function planResponse(plan: PlanWithLimits) {
  return {
    id: plan.id,
    name: plan.name,
    slug: plan.slug,
    tier: plan.tier,
    description: plan.description,
    priceAmount: plan.priceAmount,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    trialDays: plan.trialDays,
    isActive: plan.isActive,
    displayOrder: plan.displayOrder,
    limits: plan.limits.map((l) => ({ key: l.key, value: l.value })),
  };
}

function subscriptionResponse(
  subscription: SubscriptionWithPlan,
  pastDueGraceDays?: number,
) {
  const effectiveStatus = getEffectiveStatus(
    subscription,
    new Date(),
    pastDueGraceDays,
  );
  return {
    id: subscription.id,
    workspaceId: subscription.workspaceId,
    status: subscription.status,
    effectiveStatus,
    plan: planResponse(subscription.plan),
    billingPeriod: {
      start: subscription.currentPeriodStart,
      end: subscription.currentPeriodEnd,
    },
    trial:
      subscription.trialStart || subscription.trialEnd
        ? { start: subscription.trialStart, end: subscription.trialEnd }
        : null,
    cancellation: subscription.cancelAt
      ? { cancelAt: subscription.cancelAt, canceledAt: subscription.canceledAt }
      : null,
    provider: subscription.provider,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

/** subscribe/changePlan/reactivate all return this shape (Sprint 10):
 * `checkoutUrl` non-null means the frontend must redirect there instead
 * of treating `subscription` as the new state — see
 * SubscriptionMutationResult's docs. */
function mutationResponse(
  result: SubscriptionMutationResult,
  pastDueGraceDays: number,
) {
  return {
    ...subscriptionResponse(result.subscription, pastDueGraceDays),
    checkoutUrl: result.checkoutUrl,
  };
}

/**
 * Nested under /workspaces/:workspaceId/billing, matching
 * DomainsController's pattern. RBAC deliberately does NOT follow the
 * Links/Domains/Campaigns "MEMBER can mutate" precedent — see
 * docs/architecture/billing.md §RBAC: reads are VIEWER+, every mutation
 * (subscribe/change-plan/cancel/reactivate) is ADMIN+ only.
 */
@ApiTags('billing')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/billing')
@UseGuards(WorkspaceRolesGuard)
export class BillingController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly usage: BillingUsageService,
    private readonly plans: PlansService,
    private readonly invoices: InvoicesService,
    private readonly config: ConfigService,
  ) {}

  private get pastDueGraceDays(): number {
    return this.config.get<number>('paystack.pastDueGraceDays') ?? 7;
  }

  @Get()
  @Roles(WorkspaceRole.VIEWER)
  @ApiOperation({
    summary: 'Current plan, subscription status, and usage summary',
  })
  @ApiResponse({ status: 200, description: 'Billing summary' })
  async getSummary(@Param('workspaceId') workspaceId: string) {
    const { subscription, plan } =
      await this.subscriptions.getEffectivePlan(workspaceId);
    const usageSnapshot = await this.usage.getUsage(workspaceId);
    const invoiceHistory = await this.invoices.listForWorkspace(workspaceId);

    return {
      subscription: subscription
        ? subscriptionResponse(subscription, this.pastDueGraceDays)
        : null,
      plan: planResponse(plan),
      usage: usageSnapshot,
      invoiceCount: invoiceHistory.length,
    };
  }

  @Get('usage')
  @Roles(WorkspaceRole.VIEWER)
  @ApiOperation({
    summary: 'Current usage and limits for every metered resource',
  })
  @ApiResponse({ status: 200, description: 'Usage snapshot' })
  async getUsage(@Param('workspaceId') workspaceId: string) {
    return this.usage.getUsage(workspaceId);
  }

  @Get('plans')
  @Roles(WorkspaceRole.VIEWER)
  @ApiOperation({ summary: 'Available plans' })
  @ApiResponse({ status: 200, description: 'Active plans' })
  async getPlans() {
    const active = await this.plans.listActive();
    return active.map(planResponse);
  }

  @Get('invoices')
  @Roles(WorkspaceRole.VIEWER)
  @ApiOperation({ summary: 'Billing history / invoices' })
  @ApiResponse({ status: 200, description: 'Invoice list (may be empty)' })
  async getInvoices(@Param('workspaceId') workspaceId: string) {
    return this.invoices.listForWorkspace(workspaceId);
  }

  /**
   * Where the user's browser lands after a redirect-based Paystack
   * checkout (?reference=...). Fast-path UX only — see
   * SubscriptionsService.verifyCheckout's docs: the inbound webhook is
   * what actually activates the subscription, this just reports whether
   * the payment itself succeeded and returns whatever state the
   * Subscription row currently holds.
   */
  @Get('checkout/callback')
  @Roles(WorkspaceRole.VIEWER)
  @ApiOperation({
    summary: 'Fast-path verification after redirect-based checkout',
    description:
      'Read-only — does not activate anything itself. The inbound Paystack webhook remains the source of truth.',
  })
  @ApiResponse({ status: 200, description: 'Verification result' })
  async checkoutCallback(
    @Param('workspaceId') workspaceId: string,
    @Query('reference') reference: string,
  ) {
    if (!reference) {
      throw new BadRequestException('reference is required');
    }
    const result = await this.subscriptions.verifyCheckout(
      workspaceId,
      reference,
    );
    return {
      success: result.success,
      subscription: result.subscription
        ? subscriptionResponse(result.subscription, this.pastDueGraceDays)
        : null,
    };
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({
    summary: 'Start a subscription (ADMIN or OWNER)',
    description:
      'No payment provider is configured — this applies the subscription directly within LinkIQ, it does not charge any money.',
  })
  @ApiResponse({ status: 200, description: 'Subscription created/updated' })
  async subscribe(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Body() dto: PlanSlugDto,
  ) {
    const result = await this.subscriptions.subscribe(
      workspaceId,
      user.id,
      dto.planSlug,
      ctx,
    );
    return mutationResponse(result, this.pastDueGraceDays);
  }

  @Post('change-plan')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({
    summary: 'Upgrade or downgrade the current plan (ADMIN or OWNER)',
  })
  @ApiResponse({ status: 200, description: 'Plan changed' })
  async changePlan(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Body() dto: PlanSlugDto,
  ) {
    const result = await this.subscriptions.changePlan(
      workspaceId,
      user.id,
      dto.planSlug,
      ctx,
    );
    return mutationResponse(result, this.pastDueGraceDays);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({
    summary: 'Cancel at the end of the current billing period (ADMIN or OWNER)',
  })
  @ApiResponse({ status: 200, description: 'Cancellation scheduled' })
  async cancel(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    const subscription = await this.subscriptions.cancel(
      workspaceId,
      user.id,
      ctx,
    );
    return subscriptionResponse(subscription, this.pastDueGraceDays);
  }

  @Post('reactivate')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({ summary: 'Reverse a pending cancellation (ADMIN or OWNER)' })
  @ApiResponse({ status: 200, description: 'Subscription reactivated' })
  @ApiResponse({
    status: 400,
    description: 'No pending cancellation to reverse',
  })
  async reactivate(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    const result = await this.subscriptions.reactivate(
      workspaceId,
      user.id,
      ctx,
    );
    return mutationResponse(result, this.pastDueGraceDays);
  }
}
