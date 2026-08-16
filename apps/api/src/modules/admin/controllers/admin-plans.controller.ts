import { Body, Controller, Get, Inject, Logger, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import {
  Ctx,
  type RequestContext,
} from '../../../common/decorators/request-context.decorator';
import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { PlansService } from '../../billing/plans.service';
import { BILLING_PROVIDER, type BillingProvider } from '../../billing/providers/billing-provider.interface';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { UpdatePlanDto } from '../dto/update-plan.dto';

/**
 * Platform plan catalog management — SUPER_ADMIN only.
 *
 * Create/update only — deliberately no hard-delete endpoint. A Plan
 * that has ever had a subscription cannot be hard-deleted anyway
 * (Subscription.planId has no onDelete clause, so Postgres defaults to
 * RESTRICT — see schema.prisma), and even a never-subscribed plan
 * would be inconsistent with the rest of this catalog's design
 * (immutable slug, PlanLimit cascading). "Archive" a plan by
 * deactivating it via PATCH { isActive: false } — the same operation
 * already used to hide a plan from new checkouts, which is the only
 * safe "remove" semantics a live billing system supports without
 * corrupting historical Invoice/Subscription records.
 */
@ApiTags('admin-plans')
@ApiBearerAuth()
@Controller('admin/plans')
@UseGuards(SuperAdminGuard)
export class AdminPlansController {
  private readonly logger = new Logger(AdminPlansController.name);

  constructor(
    private readonly plans: PlansService,
    @Inject(BILLING_PROVIDER) private readonly billingProvider: BillingProvider,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List every plan, including inactive ones (SUPER_ADMIN only)',
  })
  @ApiResponse({ status: 200, description: 'Full plan catalog with limits' })
  async list() {
    return this.plans.listAllForAdmin();
  }

  @Get(':planId')
  @ApiOperation({ summary: 'View a single plan' })
  async getOne(@Param('planId') planId: string) {
    return this.plans.getByIdOrThrow(planId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new plan, optionally syncing it to the active payment provider',
  })
  async create(
    @Body() dto: CreatePlanDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    const { syncToProvider, ...createInput } = dto;
    let plan = await this.plans.create(createInput, admin.id, ctx);

    // Best-effort, never fails plan creation: LinkIQ's own Plan row is
    // the thing that must exist regardless of whether the provider
    // call succeeds — see BillingProvider.createProviderPlan's docs.
    if (syncToProvider && this.billingProvider.createProviderPlan) {
      try {
        const result = await this.billingProvider.createProviderPlan({
          name: plan.name,
          priceAmount: plan.priceAmount,
          currency: plan.currency,
          billingInterval: plan.billingInterval,
        });
        plan = await this.plans.updateForAdmin(
          plan.id,
          { providerPlanId: result.providerPlanId },
          admin.id,
          ctx,
        );
      } catch (error) {
        this.logger.warn(
          `Provider plan sync failed for new plan "${plan.slug}" — created locally without a providerPlanId: ${String(error)}`,
        );
      }
    }

    return plan;
  }

  @Patch(':planId')
  @ApiOperation({
    summary: 'Update a plan (price, limits, trial, active status, ...)',
  })
  async update(
    @Param('planId') planId: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.plans.updateForAdmin(planId, dto, admin.id, ctx);
  }
}
