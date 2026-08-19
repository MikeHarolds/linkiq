import { Injectable } from '@nestjs/common';
import { Prisma, type Invoice, type InvoiceStatus } from '@prisma/client';

import {
  paginationMeta,
  type PaginatedResult,
} from '../../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';

export type InvoiceWithWorkspace = Invoice & {
  workspace: { id: string; name: string; slug: string };
  targetPlan: { id: string; name: string; slug: string } | null;
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

export interface CreateOrReusePendingInvoiceInput {
  workspaceId: string;
  /** The workspace's one existing Subscription row being modified —
   * never null in practice (Sprint 7's create-default-on-signup
   * invariant), but the column itself stays nullable per the existing
   * schema. */
  subscriptionId: string | null;
  targetPlanId: string;
  amount: number;
  currency: string;
  provider: string;
}

/**
 * Billing-history/invoice reads, plus the write paths that create and
 * transition invoice records:
 *
 * - `recordProviderInvoice` (Sprint 10) — a webhook-driven, one-shot
 *   PAID/UNCOLLECTIBLE record for provider events that don't go
 *   through the invoice-first flow below (e.g. recurring-cycle
 *   invoices Paystack generates on its own).
 * - `createOrReusePendingInvoice` / `attachProviderReference` /
 *   `markPaid` / `markFailed` (Sprint 18A) — the invoice-first
 *   checkout flow: a PENDING invoice is created the moment a paid plan
 *   is selected, a provider reference is attached once checkout is
 *   initialized, and it's finally moved to PAID or FAILED only after
 *   server-side payment verification. See SubscriptionsService's
 *   `selectPlan`/`proceedToPayment`/`confirmAndActivate` for the
 *   callers of each step.
 *
 * There is still no user-facing endpoint that can fabricate a PAID
 * record directly — every PAID transition in this file is either a
 * confirmed provider webhook or a server-side-verified transaction.
 */
@Injectable()
export class InvoicesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForWorkspace(
    workspaceId: string,
  ): Promise<Array<Invoice & { targetPlan: { id: string; name: string; slug: string } | null }>> {
    return this.prisma.invoice.findMany({
      where: { workspaceId },
      orderBy: { issueDate: 'desc' },
      // Sprint 18B §10 — the customer invoice center needs to show
      // which plan each invoice was for, same targetPlan relation the
      // admin invoice list already reads (see listAllForAdmin).
      include: { targetPlan: { select: { id: true, name: true, slug: true } } },
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
          // Sprint 18A — the plan the checkout was FOR, for Part 12's
          // admin invoice view ("plan"). Null for legacy/webhook-
          // recorded invoices that predate targetPlanId.
          targetPlan: { select: { id: true, name: true, slug: true } },
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

  /**
   * Sprint 18A, step 1 of the invoice-first flow — called the moment a
   * paid plan change is selected, before any Paystack transaction
   * exists. Reuses an existing still-PENDING invoice for the same
   * workspace+targetPlan rather than piling up duplicates every time a
   * user reopens the review screen or retries an abandoned checkout
   * (Part 9/14 test #13, "retry of pending invoice works") — refreshing
   * its amount/currency/provider to the latest resolved values is safe
   * because nothing has been charged yet; an invoice only becomes
   * immutable once it leaves PENDING (see markPaid/markFailed).
   */
  async createOrReusePendingInvoice(
    input: CreateOrReusePendingInvoiceInput,
  ): Promise<Invoice> {
    const existing = await this.prisma.invoice.findFirst({
      where: {
        workspaceId: input.workspaceId,
        targetPlanId: input.targetPlanId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return this.prisma.invoice.update({
        where: { id: existing.id },
        data: {
          amount: input.amount,
          currency: input.currency,
          provider: input.provider,
          subscriptionId: input.subscriptionId,
        },
      });
    }

    const count = await this.prisma.invoice.count({
      where: { workspaceId: input.workspaceId },
    });
    const number = `LQ-${String(count + 1).padStart(4, '0')}`;

    return this.prisma.invoice.create({
      data: {
        workspaceId: input.workspaceId,
        subscriptionId: input.subscriptionId,
        targetPlanId: input.targetPlanId,
        number,
        amount: input.amount,
        currency: input.currency,
        status: 'PENDING',
        provider: input.provider,
        dueDate: new Date(),
      },
    });
  }

  /** Looks up a still-PENDING invoice scoped to its owning workspace —
   * used by the "Proceed to Payment" endpoint, which must never act on
   * an invoice belonging to a different workspace. */
  async findPendingByIdForWorkspace(
    workspaceId: string,
    invoiceId: string,
  ): Promise<Invoice | null> {
    return this.prisma.invoice.findFirst({
      where: { id: invoiceId, workspaceId, status: 'PENDING' },
    });
  }

  async findByIdForWorkspace(
    workspaceId: string,
    invoiceId: string,
  ): Promise<Invoice | null> {
    return this.prisma.invoice.findFirst({
      where: { id: invoiceId, workspaceId },
    });
  }

  /**
   * Sprint 18A, step 3 — called right after Paystack's
   * initialize-transaction call succeeds, before the user is
   * redirected. The reference is what both the callback route and the
   * webhook processor use to find their way back to this invoice (see
   * findByProviderReference).
   */
  async attachProviderReference(
    invoiceId: string,
    reference: string,
  ): Promise<Invoice> {
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { providerInvoiceId: reference },
    });
  }

  async findByProviderReference(
    provider: string,
    reference: string,
  ): Promise<Invoice | null> {
    return this.prisma.invoice.findFirst({
      where: { provider, providerInvoiceId: reference },
    });
  }

  /** Terminal transition — see the InvoiceStatus.PENDING/FAILED schema
   * docs for why a PAID invoice is never revisited. */
  async markPaid(
    invoiceId: string,
    paidAt: Date,
    period?: { start: Date; end: Date },
  ): Promise<Invoice> {
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'PAID',
        paidAt,
        // Sprint 18B — the SAME period bounds confirmAndActivate wrote
        // onto the Subscription itself, snapshotted here too so the
        // customer invoice/receipt view never needs a second lookup.
        ...(period
          ? { periodStart: period.start, periodEnd: period.end }
          : {}),
      },
    });
  }

  /** Terminal transition — a FAILED invoice is never resurrected to
   * PAID by a later/replayed signal; a retry goes through a fresh plan
   * selection (a new PENDING invoice) instead. */
  async markFailed(
    invoiceId: string,
    failureReason: string | null,
  ): Promise<Invoice> {
    return this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'FAILED', failureReason },
    });
  }
}
