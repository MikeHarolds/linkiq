import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { AssignRoleDto } from '../../roles/dto/assign-role.dto';
import { RoleResolutionService } from '../../roles/role-resolution.service';
import { QueryUsersDto } from '../dto/query-users.dto';
import { AdminUsersService } from '../services/admin-users.service';

/**
 * Platform-level user management — SUPER_ADMIN only. Every route here is
 * independently guarded by SuperAdminGuard (not just hidden from
 * navigation); a workspace OWNER/ADMIN gets 403 the same as any other
 * non-admin caller. See docs/architecture/super-admin.md.
 */
@ApiTags('admin-users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(SuperAdminGuard)
export class AdminUsersController {
  constructor(
    private readonly adminUsers: AdminUsersService,
    private readonly roleResolution: RoleResolutionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List platform users (SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Paginated user list' })
  async list(@Query() query: QueryUsersDto) {
    return this.adminUsers.list(query);
  }

  @Get(':userId')
  @ApiOperation({
    summary: 'View a user, their workspaces, and subscription context',
  })
  async getDetail(@Param('userId') userId: string) {
    return this.adminUsers.getDetail(userId);
  }

  @Get(':userId/audit-activity')
  @ApiOperation({ summary: "View a user's own audit activity" })
  async getAuditActivity(
    @Param('userId') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.adminUsers.getUserAuditActivity(
      userId,
      query.page,
      query.pageSize,
    );
  }

  @Post(':userId/suspend')
  @ApiOperation({
    summary: 'Suspend a user — disables login and revokes all sessions',
  })
  async suspend(
    @Param('userId') userId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    await this.adminUsers.suspend(userId, admin.id, ctx);
    return { success: true };
  }

  @Post(':userId/reactivate')
  @ApiOperation({ summary: 'Reactivate a suspended user' })
  async reactivate(
    @Param('userId') userId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    await this.adminUsers.reactivate(userId, admin.id, ctx);
    return { success: true };
  }

  @Post(':userId/force-logout')
  @ApiOperation({ summary: 'Revoke every active session for a user' })
  async forceLogout(
    @Param('userId') userId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    await this.adminUsers.forceLogout(userId, admin.id, ctx);
    return { success: true };
  }

  @Post(':userId/assign-role')
  @ApiOperation({
    summary:
      'Manually assign a platform role (ADMIN_ASSIGNED) — subscription lifecycle events will not overwrite it until removed',
  })
  async assignRole(
    @Param('userId') userId: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.roleResolution.assignManualRole(userId, dto.platformRoleId, admin.id, ctx);
  }

  @Post(':userId/remove-role-override')
  @ApiOperation({ summary: "Remove a manual role override — resolves the role from the user's subscription again" })
  async removeRoleOverride(
    @Param('userId') userId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.roleResolution.clearManualRole(userId, admin.id, ctx);
  }
}
