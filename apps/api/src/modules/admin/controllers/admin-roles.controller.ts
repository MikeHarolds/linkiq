import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Ctx, type RequestContext } from '../../../common/decorators/request-context.decorator';
import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { CreateRoleDto } from '../../roles/dto/create-role.dto';
import { UpdateRoleDto } from '../../roles/dto/update-role.dto';
import { PlatformRolesService } from '../../roles/platform-roles.service';

/**
 * Platform role & permission management (Sprint 15) — SUPER_ADMIN only.
 * See docs/architecture/roles-and-permissions.md for the full model.
 * Every mutation is audited by PlatformRolesService itself, not
 * duplicated here — matching AdminLandingPageController's own convention.
 */
@ApiTags('admin-roles')
@ApiBearerAuth()
@Controller('admin/roles')
@UseGuards(SuperAdminGuard)
export class AdminRolesController {
  constructor(private readonly roles: PlatformRolesService) {}

  @Get()
  @ApiOperation({ summary: 'List every platform role, including inactive ones' })
  async list() {
    return this.roles.listAll();
  }

  @Get(':roleId')
  @ApiOperation({ summary: 'View a single role, its permissions, users, and plans' })
  async getOne(@Param('roleId') roleId: string) {
    return this.roles.getByIdOrThrow(roleId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom platform role' })
  async create(
    @Body() dto: CreateRoleDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.roles.create(dto, admin.id, ctx);
  }

  @Patch(':roleId')
  @ApiOperation({ summary: 'Update a role — name, description, permissions, active state' })
  async update(
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.roles.update(roleId, dto, admin.id, ctx);
  }

  @Delete(':roleId')
  @ApiOperation({
    summary: 'Delete a custom role — rejected for system roles or any role still in use',
  })
  async delete(
    @Param('roleId') roleId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    await this.roles.delete(roleId, admin.id, ctx);
    return { success: true };
  }
}
