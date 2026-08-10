import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { WorkspaceMember } from '@prisma/client';

import { CurrentWorkspace } from '../../common/decorators/current-workspace.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WorkspaceRolesGuard } from '../../common/guards/workspace-roles.guard';

import { AnalyticsService } from './analytics.service';
import {
  AnalyticsQueryDto,
  TimeseriesQueryDto,
} from './dto/analytics-query.dto';

/**
 * Every route requires a workspace context (X-Workspace-Id header,
 * resolved by WorkspaceRolesGuard — same pattern as LinksController) and
 * is available to VIEWER and above: analytics are read-only by nature, so
 * the lowest workspace role already qualifies.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Workspace-Id',
  required: true,
  description: 'Active workspace context',
})
@UseGuards(WorkspaceRolesGuard)
@Roles('VIEWER')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Summary metrics: total clicks, human/bot breakdown, unique visitors',
  })
  @ApiResponse({ status: 200, description: 'Overview metrics' })
  overview(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getOverview(workspace.workspaceId, query);
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Clicks bucketed by hour or day, timezone-aware' })
  @ApiResponse({ status: 200, description: 'Time-series click data' })
  timeseries(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Query() query: TimeseriesQueryDto,
  ) {
    return this.analyticsService.getTimeseries(workspace.workspaceId, query);
  }

  @Get('links')
  @ApiOperation({ summary: 'Top links by click volume' })
  @ApiResponse({ status: 200, description: 'Top links' })
  topLinks(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getTopLinks(workspace.workspaceId, query);
  }

  @Get('referrers')
  @ApiOperation({
    summary:
      'Top referrer domains, with direct/search/social/referral/other categorization',
  })
  @ApiResponse({ status: 200, description: 'Top referrers' })
  referrers(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getReferrers(workspace.workspaceId, query);
  }

  @Get('geography')
  @ApiOperation({ summary: 'Top countries and regions' })
  @ApiResponse({ status: 200, description: 'Geographic breakdown' })
  geography(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getGeography(workspace.workspaceId, query);
  }

  @Get('devices')
  @ApiOperation({ summary: 'Device type breakdown (desktop/mobile/tablet)' })
  @ApiResponse({ status: 200, description: 'Device breakdown' })
  devices(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getDevices(workspace.workspaceId, query);
  }

  @Get('browsers')
  @ApiOperation({ summary: 'Browser breakdown' })
  @ApiResponse({ status: 200, description: 'Browser breakdown' })
  browsers(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getBrowsers(workspace.workspaceId, query);
  }

  @Get('operating-systems')
  @ApiOperation({ summary: 'Operating system breakdown' })
  @ApiResponse({ status: 200, description: 'Operating system breakdown' })
  operatingSystems(
    @CurrentWorkspace() workspace: WorkspaceMember,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getOperatingSystems(
      workspace.workspaceId,
      query,
    );
  }
}
