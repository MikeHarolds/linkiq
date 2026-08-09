import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
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

import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@ApiBearerAuth()
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  @ApiOperation({ summary: "List the authenticated user's workspaces" })
  @ApiResponse({ status: 200, description: 'Workspaces the caller belongs to' })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.listForUser(user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new workspace',
    description: 'The caller becomes the workspace OWNER.',
  })
  @ApiResponse({ status: 201, description: 'Workspace created' })
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkspaceDto,
    @Ctx() ctx: RequestContext,
  ) {
    return this.workspacesService.create(user.id, dto, ctx);
  }

  @Get(':workspaceId')
  @UseGuards(WorkspaceRolesGuard)
  @Roles(WorkspaceRole.VIEWER)
  @ApiHeader({
    name: 'X-Workspace-Id',
    required: false,
    description: 'Not needed — :workspaceId in the path is used instead.',
  })
  @ApiOperation({ summary: 'Get a single workspace (any member)' })
  @ApiResponse({ status: 200, description: 'Workspace details' })
  @ApiResponse({ status: 403, description: 'Not a member of this workspace' })
  async findOne(@Param('workspaceId') workspaceId: string) {
    return this.workspacesService.findByIdOrThrow(workspaceId);
  }

  @Patch(':workspaceId')
  @UseGuards(WorkspaceRolesGuard)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({ summary: 'Update workspace information (ADMIN or OWNER)' })
  @ApiResponse({ status: 200, description: 'Workspace updated' })
  @ApiResponse({ status: 403, description: 'Insufficient workspace role' })
  async update(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateWorkspaceDto,
    @Ctx() ctx: RequestContext,
  ) {
    return this.workspacesService.update(workspaceId, user.id, dto, ctx);
  }

  @Get(':workspaceId/members')
  @UseGuards(WorkspaceRolesGuard)
  @Roles(WorkspaceRole.VIEWER)
  @ApiOperation({ summary: 'List workspace members (any member)' })
  @ApiResponse({ status: 200, description: 'Members list' })
  async listMembers(@Param('workspaceId') workspaceId: string) {
    const members = await this.workspacesService.listMembers(workspaceId);
    return members.map((m) => ({
      id: m.id,
      role: m.role,
      createdAt: m.createdAt,
      user: m.user,
    }));
  }

  @Post(':workspaceId/members/invite')
  @UseGuards(WorkspaceRolesGuard)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({
    summary: 'Invite an existing LinkIQ user to the workspace (ADMIN or OWNER)',
    description:
      'The invited email must already have a LinkIQ account — there is no pending-invitation email flow yet.',
  })
  @ApiResponse({ status: 201, description: 'Member added' })
  @ApiResponse({ status: 404, description: 'No account exists for that email' })
  @ApiResponse({ status: 409, description: 'Already a member' })
  @HttpCode(HttpStatus.CREATED)
  async inviteMember(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteMemberDto,
    @Ctx() ctx: RequestContext,
  ) {
    const member = await this.workspacesService.inviteMember(
      workspaceId,
      user.id,
      dto,
      ctx,
    );
    return {
      id: member.id,
      role: member.role,
      createdAt: member.createdAt,
      user: member.user,
    };
  }

  @Patch(':workspaceId/members/:memberId')
  @UseGuards(WorkspaceRolesGuard)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({ summary: "Change a member's role (ADMIN or OWNER)" })
  @ApiResponse({ status: 200, description: 'Role updated' })
  @ApiResponse({
    status: 400,
    description: 'Would leave the workspace without an owner',
  })
  async updateMemberRole(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMemberRoleDto,
    @Ctx() ctx: RequestContext,
  ) {
    return this.workspacesService.updateMemberRole(
      workspaceId,
      memberId,
      user.id,
      dto,
      ctx,
    );
  }

  @Delete(':workspaceId/members/:memberId')
  @UseGuards(WorkspaceRolesGuard)
  @Roles(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a member from the workspace (ADMIN or OWNER)',
  })
  @ApiResponse({ status: 204, description: 'Member removed' })
  @ApiResponse({
    status: 400,
    description: 'Would leave the workspace without an owner',
  })
  async removeMember(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.workspacesService.removeMember(
      workspaceId,
      memberId,
      user.id,
      ctx,
    );
  }
}
