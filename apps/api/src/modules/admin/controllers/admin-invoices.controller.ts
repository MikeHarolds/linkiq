import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import { InvoicesService } from '../../billing/invoices.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QueryInvoicesDto } from '../dto/query-invoices.dto';

/**
 * Platform-level invoice register — SUPER_ADMIN only. Same underlying
 * data as /admin/payments (see InvoicesService.listAllForAdmin's docs),
 * framed as an invoice/customer register rather than a transaction feed.
 * No PDF/document generation exists in this codebase — nothing here
 * fakes one; "view invoice" returns the structured record only.
 */
@ApiTags('admin-invoices')
@ApiBearerAuth()
@Controller('admin/invoices')
@UseGuards(SuperAdminGuard)
export class AdminInvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List platform invoices (SUPER_ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Paginated invoice list' })
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

  @Get(':invoiceId')
  @ApiOperation({ summary: 'View a single invoice' })
  async getOne(@Param('invoiceId') invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        workspace: { select: { id: true, name: true, slug: true } },
        targetPlan: { select: { id: true, name: true, slug: true } },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }
}
