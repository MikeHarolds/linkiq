import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import { AuditService } from '../../audit/audit.service';
import { QueryAuditLogsDto } from '../dto/query-audit-logs.dto';

/**
 * Platform-wide audit search — SUPER_ADMIN only. Reuses
 * AuditService.list (the same ledger every module already writes to via
 * AuditService.record — see audit.service.ts) rather than a parallel
 * admin-only log. Metadata is never redacted here beyond what record()
 * itself already guarantees: no call site anywhere in the codebase has
 * ever written a secret into `metadata` (see that method's own docs).
 * Every Super Admin action in THIS module (suspend/reactivate/
 * force-logout/plan update/subscription mutation) is itself recorded
 * via the exact same AuditService.record() calls, so it shows up here
 * too — Super Admin actions are never exempt from the audit trail.
 */
@ApiTags('admin-audit-logs')
@ApiBearerAuth()
@Controller('admin/audit-logs')
@UseGuards(SuperAdminGuard)
export class AdminAuditLogsController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Search platform audit logs (SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Paginated audit log entries' })
  async list(@Query() query: QueryAuditLogsDto) {
    return this.audit.list({
      page: query.page,
      pageSize: query.pageSize,
      userId: query.userId,
      workspaceId: query.workspaceId,
      action: query.action,
      entity: query.entity,
      search: query.search,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    });
  }
}
