import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import { DateRangeDto, resolveDateRange } from '../dto/date-range.dto';
import { AdminApiUsageService } from '../services/admin-api-usage.service';

/** Never returns a raw API key secret or full key value — only
 * `keyPrefix`-shaped metadata already exists anywhere in this data
 * (ApiKey.keyHash is never selected by any query this controller
 * reaches — see ApiKeysService's SAFE_SELECT, reused platform-wide). */
@ApiTags('admin-api-usage')
@ApiBearerAuth()
@Controller('admin/api-usage')
@UseGuards(SuperAdminGuard)
export class AdminApiUsageController {
  constructor(private readonly apiUsage: AdminApiUsageService) {}

  @Get()
  @ApiOperation({ summary: 'Platform API usage overview (SUPER_ADMIN only)' })
  @ApiResponse({
    status: 200,
    description: 'Requests, failures, active keys, top workspaces, time series',
  })
  async getOverview(@Query() query: DateRangeDto) {
    const { from, to } = resolveDateRange(query.range);
    return this.apiUsage.getOverview(from, to);
  }
}
