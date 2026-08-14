import { Injectable } from '@nestjs/common';
import { Prisma, type Invoice, type InvoiceStatus } from '@prisma/client';

import {
  paginationMeta,
  type PaginatedResult,
} from '../../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';

export type InvoiceWithWorkspace = Invoice & {
  workspace: { id: string; name: string; slug: string };
};

export interface ListInvoicesQuery {
  page: number;
  pageSize: number;
  status?: InvoiceStatus;
  provider?: string;
  workspaceId?: string;
  /** Matches against invoice number or providerInvoiceId (the payment
   * reference), case-insensitive. */
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

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

  /**
   * Platform-wide payment/invoice ledger (Sprint 11 — Super Admin).
   * Serves both /admin/payments and /admin/invoices — the current
   * `Invoice` model (amount, currency, provider, providerInvoiceId,
   * status, failureReason, timestamps) already carries everything both
   * views need; no new "payment" table or duplicate record was created,
   * per the sprint's explicit instruction not to fork the data model.
   * The two admin routes just present the same rows with different
   * emphasis (payments = transaction/reference-first, invoices =
   * invoice-number/customer-first).
   */
  async listAllForAdmin(
    query: ListInvoicesQuery,
  ): Promise<PaginatedResult<InvoiceWithWorkspace>> {
    const searchTerm = query.search?.trim();
    const where: Prisma.InvoiceWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            issueDate: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
      ...(searchTerm
        ? {
            OR: [
              { number: { contains: searchTerm, mode: 'insensitive' } },
              {
                providerInvoiceId: {
                  contains: searchTerm,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: { issueDate: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          workspace: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      items,
      pagination: paginationMeta(query.page, query.pageSize, totalItems),
    };
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
