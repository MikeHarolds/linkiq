import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
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
import { UpdatePlanDto } from '../dto/update-plan.dto';

/**
 * Platform plan catalog management — SUPER_ADMIN only. Read/update only:
 * no create or delete endpoint, matching PlansService's own design (plans
 * are seed-managed rows, identified by an immutable slug other code
 * keys off of — see plans.service.ts). Every write is audited.
 */
@ApiTags('admin-plans')
@ApiBearerAuth()
@Controller('admin/plans')
@UseGuards(SuperAdminGuard)
export class AdminPlansController {
  constructor(private readonly plans: PlansService) {}

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
