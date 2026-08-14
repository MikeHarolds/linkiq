import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import { InvoicesService } from '../../billing/invoices.service';
import { QueryInvoicesDto } from '../dto/query-invoices.dto';

/**
 * Platform-level transaction/payment view — SUPER_ADMIN only. Backed by
 * the same `Invoice` rows /admin/invoices shows (see
 * InvoicesService.listAllForAdmin's docs on why no second "payment"
 * table was created), just filtered/framed as a transaction ledger
 * (reference-first). Never exposes card data, CVV, PIN, or provider
 * secrets — the Invoice model has never stored any of those (Sprint 10's
 * redirect-based checkout keeps LinkIQ entirely out of PCI scope).
 */
@ApiTags('admin-payments')
@ApiBearerAuth()
@Controller('admin/payments')
@UseGuards(SuperAdminGuard)
export class AdminPaymentsController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @ApiOperation({
    summary: 'List platform payment transactions (SUPER_ADMIN only)',
  })
  @ApiResponse({ status: 200, description: 'Paginated transaction list' })
  async list(@Query() query: QueryInvoicesDto) {
    return this.invoices.listAllForAdmin({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
      provider: query.provider,
      workspaceId: query.workspaceId,
      search: query.search,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
    });
  }
}
