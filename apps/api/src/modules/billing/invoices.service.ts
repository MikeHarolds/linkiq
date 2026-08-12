import { Injectable } from '@nestjs/common';
import type { Invoice } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Billing-history/invoice reads. No write path exists yet in this
 * sprint's API surface — invoices only ever get created by a real
 * payment provider's webhook events (once one is integrated) or by
 * clearly-marked development seed data, never by a user-facing endpoint,
 * so there's no way for this application to fabricate a PAID record.
 */
@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForWorkspace(workspaceId: string): Promise<Invoice[]> {
    return this.prisma.invoice.findMany({
      where: { workspaceId },
      orderBy: { issueDate: 'desc' },
    });
  }
}
