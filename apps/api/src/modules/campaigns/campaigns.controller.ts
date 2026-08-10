import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import { CampaignStatus, type WorkspaceMember } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../common/decorators/current-workspace.decorator';
import {
  Ctx,
  type RequestContext,
} from '../../common/decorators/request-context.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';
import { TimeseriesQueryDto } from '../analytics/dto/analytics-query.dto';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';

import { CampaignAnalyticsService } from './campaign-analytics.service';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { QueryCampaignsDto } from './dto/query-campaigns.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

/**
 * Every route requires a workspace context (X-Workspace-Id header,
 * resolved by WorkspaceRolesGuard — the same pattern as Links/QrCodes).
 * VIEWER gets read + analytics access; MEMBER and above get full
 * management, matching the spec's RBAC table exactly.
 */
@ApiTags('campaigns')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Workspace-Id',
  required: true,
  description: 'Active workspace context',
})
@UseGuards(WorkspaceRolesGuard)
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaignsService: CampaignsService,
    private readonly campaignAnalytics: CampaignAnalyticsService,
  ) {}

  @Post()
  @Roles('MEMBER')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a campaign (MEMBER, ADMIN, or OWNER)' })
  @ApiResponse({ status: 201, description: 'Campaign created' })
  @ApiResponse({
    status: 400,
    description: 'Invalid name, date range, or UTM values',
  })
  @ApiResponse({
    status: 409,
    description: 'A campaign with this name already exists in this workspace',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateCampaignDto,
  ) {
    return this.campaignsService.create(
      workspace.workspaceId,
      user.id,
      dto,
      ctx,
    );
  }

  @Get()
  @Roles('VIEWER')
  @ApiOperation({
    summary: 'List campaigns (paginated, searchable, filterable)',
  })
  @ApiResponse({
    status: 200,
    description: 'Paginated campaign list, each with its current link count',
  })
  async findAll(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Query() query: QueryCampaignsDto,
  ) {
    return this.campaignsService.findAll(workspace.workspaceId, query);
  }

  @Get(':id')
  @Roles('VIEWER')
  @ApiOperation({ summary: 'Get a single campaign' })
  @ApiResponse({ status: 200, description: 'Campaign details' })
  @ApiResponse({
    status: 404,
    description: 'Not found (including campaigns in another workspace)',
  })
  async findOne(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaignsService.findByIdOrThrow(workspace.workspaceId, id);
  }

  @Get(':id/links')
  @Roles('VIEWER')
  @ApiOperation({
    summary: "List links assigned to this campaign, with each link's QR codes",
  })
  @ApiResponse({ status: 200, description: 'Links in this campaign' })
  async findLinks(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaignsService.findLinksForCampaign(
      workspace.workspaceId,
      id,
    );
  }

  @Get(':id/analytics')
  @Roles('VIEWER')
  @ApiOperation({
    summary:
      'Full campaign analytics: overview, click trend, top links/sources/mediums/countries, device and referrer breakdowns',
    description:
      'Entirely derived from existing ClickEvent data — no separate campaign analytics pipeline.',
  })
  @ApiResponse({ status: 200, description: 'Campaign analytics' })
  async analytics(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TimeseriesQueryDto,
  ) {
    // Validates the campaign exists in this workspace before running any
    // analytics query against it (404s rather than silently returning
    // all-zero analytics for a campaign the caller can't see or that
    // doesn't exist).
    await this.campaignsService.findByIdOrThrow(workspace.workspaceId, id);
    return this.campaignAnalytics.getFullAnalytics(
      workspace.workspaceId,
      id,
      query,
    );
  }

  @Patch(':id')
  @Roles('MEMBER')
  @ApiOperation({ summary: 'Update a campaign (MEMBER, ADMIN, or OWNER)' })
  @ApiResponse({ status: 200, description: 'Campaign updated' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaignsService.update(
      workspace.workspaceId,
      id,
      user.id,
      dto,
      ctx,
    );
  }

  @Delete(':id')
  @Roles('MEMBER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Delete a campaign — its links are NEVER deleted or disabled (MEMBER, ADMIN, or OWNER)',
  })
  @ApiResponse({ status: 204, description: 'Campaign deleted' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.campaignsService.softDelete(
      workspace.workspaceId,
      id,
      user.id,
      ctx,
    );
  }

  @Post(':id/activate')
  @Roles('MEMBER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a campaign (from DRAFT or PAUSED)' })
  @ApiResponse({ status: 200, description: 'Campaign activated' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  async activate(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaignsService.transitionStatus(
      workspace.workspaceId,
      id,
      user.id,
      CampaignStatus.ACTIVE,
      ctx,
    );
  }

  @Post(':id/pause')
  @Roles('MEMBER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause a campaign (from ACTIVE)' })
  @ApiResponse({ status: 200, description: 'Campaign paused' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  async pause(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaignsService.transitionStatus(
      workspace.workspaceId,
      id,
      user.id,
      CampaignStatus.PAUSED,
      ctx,
    );
  }

  @Post(':id/archive')
  @Roles('MEMBER')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Archive a campaign — retained for history; its links are unaffected',
  })
  @ApiResponse({ status: 200, description: 'Campaign archived' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.campaignsService.transitionStatus(
      workspace.workspaceId,
      id,
      user.id,
      CampaignStatus.ARCHIVED,
      ctx,
    );
  }
}
