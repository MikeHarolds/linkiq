import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import { DomainsService } from '../../domains/domains.service';
import { QueryDomainsAdminDto } from '../dto/query-domains-admin.dto';

/**
 * Platform-wide custom-domain visibility — SUPER_ADMIN only. Reuses
 * DomainsService.findAllForAdmin (Sprint 6's own CustomDomain model,
 * just without the workspaceId filter) — no second domain-management
 * implementation, per the sprint's explicit instruction.
 */
@ApiTags('admin-domains')
@ApiBearerAuth()
@Controller('admin/domains')
@UseGuards(SuperAdminGuard)
export class AdminDomainsController {
  constructor(private readonly domains: DomainsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List every custom domain across every workspace (SUPER_ADMIN only)',
  })
  @ApiResponse({ status: 200, description: 'Paginated domain list' })
  async list(@Query() query: QueryDomainsAdminDto) {
    return this.domains.findAllForAdmin(query);
  }
}
