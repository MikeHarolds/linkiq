import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
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
  BILLING_PROVIDER,
  type BillingProvider,
} from './providers/billing-provider.interface';
import {
  SubscriptionsService,
  type SubscriptionMutationResult,
  type SubscriptionWithPlan,
} from './subscriptions.service';
import { getEffectiveStatus } from './utils/effective-status';

/** Sprint 16 — `providerCurrencies: undefined` means "every active
 * LinkIQ currency" (no supported-currency allowlist configured, e.g.
 * DevelopmentBillingProvider) rather than an empty/false-negative list
 * — see BillingProvider.getSupportedCurrencies's own docs. */
function planResponse(
  plan: PlanWithLimits,
  providerCurrencies: string[] | undefined,
) {
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
    prices: plan.prices.map((p) => ({
      currencyCode: p.currency.code,
      amount: p.amount,
      isConverted: p.isConverted,
      providerAvailable:
        !providerCurrencies || providerCurrencies.includes(p.currency.code),
    })),
    providerAvailable:
      !providerCurrencies || providerCurrencies.includes(plan.currency),
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
    plan: planResponse(subscription.plan, undefined),
    currency: subscription.currency,
    amount: subscription.amount,
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

function invoiceResponse(invoice: {
  id: string;
  workspaceId: string;
  subscriptionId: string | null;
  targetPlanId: string | null;
  targetPlan?: { id: string; name: string; slug: string } | null;
  number: string;
  amount: number;
  currency: string;
  status: string;
  issueDate: Date;
  dueDate: Date | null;
  paidAt: Date | null;
  provider: string | null;
  providerInvoiceId: string | null;
  hostedInvoiceUrl: string | null;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  exchangeRate: unknown;
  exchangeRateAsOf: Date | null;
}) {
  return {
    id: invoice.id,
    workspaceId: invoice.workspaceId,
    subscriptionId: invoice.subscriptionId,
    targetPlanId: invoice.targetPlanId,
    targetPlan: invoice.targetPlan ?? null,
    number: invoice.number,
    amount: invoice.amount,
    currency: invoice.currency,
    status: invoice.status,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paidAt: invoice.paidAt,
    provider: invoice.provider,
    providerInvoiceId: invoice.providerInvoiceId,
    hostedInvoiceUrl: invoice.hostedInvoiceUrl,
    periodStart: invoice.periodStart ?? null,
    periodEnd: invoice.periodEnd ?? null,
    exchangeRate: invoice.exchangeRate?.toString() ?? null,
    exchangeRateAsOf: invoice.exchangeRateAsOf,
  };
}

/** subscribe/changePlan/reactivate all return this shape (Sprint 10):
 * `checkoutUrl` non-null means the frontend must redirect there instead
 * of treating `subscription` as the new state. Sprint 18A adds
 * `invoice`: non-null means a PENDING invoice was created for review —
 * the frontend shows the invoice-review screen and calls
 * POST .../invoices/:invoiceId/pay ("Proceed to Payment") next. See
 * SubscriptionMutationResult's own docs for why exactly one of
 * checkoutUrl/invoice is ever set. */
function mutationResponse(
  result: SubscriptionMutationResult,
  pastDueGraceDays: number,
) {
  return {
    ...subscriptionResponse(result.subscription, pastDueGraceDays),
    checkoutUrl: result.checkoutUrl,
    invoice: result.invoice ? invoiceResponse(result.invoice) : null,
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
    @Inject(BILLING_PROVIDER) private readonly billingProvider: BillingProvider,
  ) {}

  private get providerCurrencies(): string[] | undefined {
    return this.billingProvider.getSupportedCurrencies?.();
  }

  /** Sprint 17 §6 — the currently configured gateway's machine name
   * (e.g. "paystack"), or null when none is configured
   * (DevelopmentBillingProvider). The ONLY thing that drives which
   * gateway option the checkout confirmation UI shows — never a
   * hardcoded frontend string, never a fake/inactive gateway. */
  private get activeProvider(): string | null {
    return this.billingProvider.getProviderName?.() ?? null;
  }

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
      plan: planResponse(plan, this.providerCurrencies),
      usage: usageSnapshot,
      invoiceCount: invoiceHistory.length,
      activeProvider: this.activeProvider,
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
    return active.map((plan) => planResponse(plan, this.providerCurrencies));
  }

  @Get('invoices')
  @Roles(WorkspaceRole.VIEWER)
  @ApiOperation({ summary: 'Billing history / invoices' })
  @ApiResponse({ status: 200, description: 'Invoice list (may be empty)' })
  async getInvoices(@Param('workspaceId') workspaceId: string) {
    const invoices = await this.invoices.listForWorkspace(workspaceId);
    return invoices.map((invoice) => invoiceResponse(invoice));
  }

  /**
   * Sprint 18A, step 3 — the explicit "Proceed to Payment" action from
   * the invoice-review screen. Initializes a real Paystack transaction
   * against the given PENDING invoice's OWN stored currency/amount
   * (never a request body value — Part 11) and returns the
   * authorization URL to redirect to. See
   * SubscriptionsService.proceedToPayment's docs.
   */
  @Post('invoices/:invoiceId/pay')
  @HttpCode(HttpStatus.OK)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({
    summary: 'Proceed to payment for a pending invoice (ADMIN or OWNER)',
  })
  @ApiResponse({ status: 200, description: 'Checkout authorization URL' })
  async payInvoice(
    @Param('workspaceId') workspaceId: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.subscriptions.proceedToPayment(
      workspaceId,
      user.id,
      invoiceId,
      ctx,
    );
  }

  /**
   * Where the user's browser lands after a redirect-based Paystack
   * checkout (?reference=...). Sprint 18A — no longer read-only: it
   * independently re-verifies the transaction server-side
   * (BillingProvider.verifyTransaction, never trusting the query
   * string reference alone) and, only on a verified success, activates
   * the subscription via SubscriptionsService.confirmAndActivate — the
   * SAME shared, idempotent function the inbound webhook calls, so
   * whichever of the two fires first does the real work and the other
   * is a guaranteed no-op. A transaction with no correlated LinkIQ
   * Invoice (applied: false, invoice: null) falls back to the old
   * read-only verifyCheckout behavior, for any checkout that never
   * went through the invoice-first flow.
   */
  @Get('checkout/callback')
  @Roles(WorkspaceRole.VIEWER)
  @ApiOperation({
    summary: 'Server-side verification and activation after checkout',
    description:
      'Independently verifies the transaction with the payment provider before activating anything — never trusts the query string alone. Idempotent: safe to call repeatedly.',
  })
  @ApiResponse({ status: 200, description: 'Verification/activation result' })
  async checkoutCallback(
    @Param('workspaceId') workspaceId: string,
    @Query('reference') reference: string,
  ) {
    if (!reference) {
      throw new BadRequestException('reference is required');
    }

    const verification = await this.billingProvider.verifyTransaction(
      reference,
    );

    const result = await this.subscriptions.confirmAndActivate({
      reference: verification.reference,
      status: verification.success ? 'success' : 'failed',
      amountKobo: verification.amountKobo,
      currency: verification.currency,
      customerCode: verification.customerCode,
      metadata: verification.metadata,
    });

    if (!result.invoice) {
      // No invoice-first record for this transaction — fall back to
      // the old read-only status peek (see verifyCheckout's docs). The
      // verification above already told us whether payment succeeded;
      // no need for a second provider call.
      const subscription = await this.subscriptions.getForWorkspace(
        workspaceId,
      );
      return {
        success: verification.success,
        invoice: null,
        subscription: subscription
          ? subscriptionResponse(subscription, this.pastDueGraceDays)
          : null,
      };
    }

    return {
      success: result.invoice.status === 'PAID',
      invoice: invoiceResponse(result.invoice),
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
      dto.currency,
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
      dto.currency,
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
