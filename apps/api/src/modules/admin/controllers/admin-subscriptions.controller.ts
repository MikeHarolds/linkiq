import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { PlanSlugDto } from '../../billing/dto/plan-slug.dto';
import { InvoicesService } from '../../billing/invoices.service';
import { SubscriptionsService } from '../../billing/subscriptions.service';
import { ExtendTrialDto } from '../dto/extend-trial.dto';
import { QuerySubscriptionsDto } from '../dto/query-subscriptions.dto';

/**
 * Platform-wide subscription management — SUPER_ADMIN only. Every
 * mutation below calls straight into SubscriptionsService's existing
 * subscribe/changePlan/cancel/reactivate methods with the admin as the
 * acting user — the BillingProvider abstraction (and Paystack behind
 * it) is never bypassed; there is no separate admin-only billing write
 * path. See docs/architecture/super-admin.md.
 */
@ApiTags('admin-subscriptions')
@ApiBearerAuth()
@Controller('admin/subscriptions')
@UseGuards(SuperAdminGuard)
export class AdminSubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly invoices: InvoicesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List platform subscriptions (SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Paginated subscription list' })
  async list(@Query() query: QuerySubscriptionsDto) {
    return this.subscriptions.listAllForAdmin(query);
  }

  @Get(':workspaceId/invoices')
  @ApiOperation({ summary: "View a workspace's billing history" })
  async billingHistory(@Param('workspaceId') workspaceId: string) {
    return this.invoices.listForWorkspace(workspaceId);
  }

  @Post(':workspaceId/change-plan')
  @ApiOperation({ summary: 'Change a workspace plan on the admin’s behalf' })
  async changePlan(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: PlanSlugDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.subscriptions.changePlan(
      workspaceId,
      admin.id,
      dto.planSlug,
      ctx,
    );
  }

  @Post(':workspaceId/cancel')
  @ApiOperation({ summary: 'Cancel a workspace subscription at period end' })
  async cancel(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.subscriptions.cancel(workspaceId, admin.id, ctx);
  }

  @Post(':workspaceId/reactivate')
  @ApiOperation({ summary: 'Reverse a pending cancellation' })
  async reactivate(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.subscriptions.reactivate(workspaceId, admin.id, ctx);
  }

  @Post(':workspaceId/extend-trial')
  @ApiOperation({ summary: 'Extend a currently-trialing subscription' })
  async extendTrial(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: ExtendTrialDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.subscriptions.extendTrial(
      workspaceId,
      new Date(dto.trialEnd),
      admin.id,
      ctx,
    );
  }
}
