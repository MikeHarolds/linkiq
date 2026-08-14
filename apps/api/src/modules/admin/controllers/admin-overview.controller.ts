import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import { DateRangeDto, resolveDateRange } from '../dto/date-range.dto';
import { AdminOverviewService } from '../services/admin-overview.service';

@ApiTags('admin-overview')
@ApiBearerAuth()
@Controller('admin/overview')
@UseGuards(SuperAdminGuard)
export class AdminOverviewController {
  constructor(private readonly overview: AdminOverviewService) {}

  @Get()
  @ApiOperation({ summary: 'Platform-level metrics (SUPER_ADMIN only)' })
  @ApiResponse({
    status: 200,
    description:
      'Users, workspaces, links, clicks, subscriptions, revenue, ops health',
  })
  async getOverview(@Query() query: DateRangeDto) {
    const { from, to } = resolveDateRange(query.range);
    return this.overview.getOverview(from, to);
  }
}
