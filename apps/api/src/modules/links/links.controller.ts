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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LinkStatus, type WorkspaceMember } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../common/decorators/current-workspace.decorator';
import {
  Ctx,
  type RequestContext,
} from '../../common/decorators/request-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

import { CreateLinkDto } from './dto/create-link.dto';
import { QueryLinksDto } from './dto/query-links.dto';
import { UpdateLinkDto } from './dto/update-link.dto';
import { LinksService } from './links.service';

/**
 * Every route here requires a workspace context — resolved by
 * WorkspaceRolesGuard from the `X-Workspace-Id` header (links aren't
 * nested under /workspaces/:id/ the way workspace-membership routes are,
 * since a link's identity is its own resource, not a workspace
 * sub-resource in the URL). @Roles(...) applies the guard; @CurrentWorkspace()
 * reads back the membership row it resolved and verified.
 */
@ApiTags('links')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Workspace-Id',
  required: true,
  description: 'Active workspace context',
})
@Controller('links')
export class LinksController {
  constructor(private readonly linksService: LinksService) {}

  @Post()
  @UseGuards(WorkspaceRolesGuard)
  @Roles('MEMBER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a short link (MEMBER, ADMIN, or OWNER)' })
  @ApiResponse({ status: 201, description: 'Link created' })
  @ApiResponse({
    status: 400,
    description: 'Invalid destination URL, slug, or expiresAt',
  })
  @ApiResponse({ status: 409, description: 'Slug already in use' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateLinkDto,
  ) {
    return this.linksService.create(workspace.workspaceId, user.id, dto, ctx);
  }

  @Get()
  @UseGuards(WorkspaceRolesGuard)
  @Roles('VIEWER')
  @ApiOperation({
    summary: 'List links in the active workspace',
    description:
      'Supports pagination, search (title/shortCode/destinationUrl), status filter, date range, and sorting.',
  })
  @ApiResponse({ status: 200, description: 'Paginated link list' })
  async findAll(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Query() query: QueryLinksDto,
  ) {
    return this.linksService.findAll(workspace.workspaceId, query);
  }

  @Get('stats')
  @UseGuards(WorkspaceRolesGuard)
  @Roles('VIEWER')
  @ApiOperation({
    summary: 'Structural link counts for the dashboard',
    description:
      'Total/active/paused/expired/archived counts and the 5 most recent links. These are structural counts, not click analytics — click-level analytics are introduced in a later milestone.',
  })
  @ApiResponse({ status: 200, description: 'Workspace link statistics' })
  async stats(@CurrentWorkspace() workspace: WorkspaceMember) {
    return this.linksService.getWorkspaceStats(workspace.workspaceId);
  }

  @Get(':id')
  @UseGuards(WorkspaceRolesGuard)
  @Roles('VIEWER')
  @ApiOperation({ summary: 'Get a single link' })
  @ApiResponse({ status: 200, description: 'Link details' })
  @ApiResponse({
    status: 404,
    description: 'Not found (including links belonging to another workspace)',
  })
  async findOne(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Param('id') id: string,
  ) {
    return this.linksService.findByIdOrThrow(workspace.workspaceId, id);
  }

  @Patch(':id')
  @UseGuards(WorkspaceRolesGuard)
  @Roles('MEMBER')
  @ApiOperation({ summary: 'Update a link (MEMBER, ADMIN, or OWNER)' })
  @ApiResponse({ status: 200, description: 'Link updated' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateLinkDto,
  ) {
    return this.linksService.update(
      workspace.workspaceId,
      id,
      user.id,
      dto,
      ctx,
    );
  }

  @Delete(':id')
  @UseGuards(WorkspaceRolesGuard)
  @Roles('MEMBER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a link (MEMBER, ADMIN, or OWNER)' })
  @ApiResponse({ status: 204, description: 'Link deleted' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.linksService.softDelete(workspace.workspaceId, id, user.id, ctx);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkspaceRolesGuard)
  @Roles('MEMBER')
  @ApiOperation({
    summary: 'Pause a link — blocks redirects, preserves history',
  })
  @ApiResponse({ status: 200, description: 'Link paused' })
  @ApiResponse({ status: 400, description: 'Link is already paused' })
  async pause(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.linksService.transitionStatus(
      workspace.workspaceId,
      id,
      user.id,
      LinkStatus.PAUSED,
      ctx,
    );
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkspaceRolesGuard)
  @Roles('MEMBER')
  @ApiOperation({
    summary: 'Activate (or reactivate) a link — from PAUSED or ARCHIVED',
  })
  @ApiResponse({ status: 200, description: 'Link activated' })
  @ApiResponse({ status: 400, description: 'Link is already active' })
  async activate(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.linksService.transitionStatus(
      workspace.workspaceId,
      id,
      user.id,
      LinkStatus.ACTIVE,
      ctx,
    );
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkspaceRolesGuard)
  @Roles('MEMBER')
  @ApiOperation({
    summary: 'Archive a link — retained for history, cannot redirect',
  })
  @ApiResponse({ status: 200, description: 'Link archived' })
  @ApiResponse({ status: 400, description: 'Link is already archived' })
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.linksService.transitionStatus(
      workspace.workspaceId,
      id,
      user.id,
      LinkStatus.ARCHIVED,
      ctx,
    );
  }
}
