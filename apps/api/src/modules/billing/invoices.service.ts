import { Injectable } from '@nestjs/common';
import type { Invoice, InvoiceStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface RecordProviderInvoiceInput {
  workspaceId: string;
  subscriptionId: string | null;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  provider: string;
  providerInvoiceId?: string | null;
  failureReason?: string | null;
  paidAt?: Date | null;
}

/**
 * Billing-history/invoice reads, plus (Sprint 10) the one write path:
 * recording an invoice from a real provider's webhook event
 * (PaystackWebhookProcessor, the only caller of recordProviderInvoice) —
 * there is still no user-facing endpoint that can fabricate a PAID
 * record, only clearly-marked development seed data and confirmed
 * provider events.
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

  /** Number generation is a count-then-format, not a DB sequence — under
   * concurrent webhook processing for the *same* workspace this could
   * theoretically race, but @@unique([workspaceId, number]) turns any
   * such race into a thrown error (the event is marked FAILED for
   * follow-up) rather than silent data corruption — an acceptable
   * tradeoff at this sprint's webhook concurrency (5). */
  async recordProviderInvoice(
    input: RecordProviderInvoiceInput,
  ): Promise<Invoice> {
    const count = await this.prisma.invoice.count({
      where: { workspaceId: input.workspaceId },
    });
    const number = `PS-${String(count + 1).padStart(4, '0')}`;

    return this.prisma.invoice.create({
      data: {
        workspaceId: input.workspaceId,
        subscriptionId: input.subscriptionId,
        number,
        amount: input.amount,
        currency: input.currency,
        status: input.status,
        provider: input.provider,
        providerInvoiceId: input.providerInvoiceId,
        failureReason: input.failureReason,
        paidAt: input.paidAt,
      },
    });
  }
}
