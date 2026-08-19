import { InvoiceStatus } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { PrismaService } from '../prisma/prisma.service';

import { InvoicesService } from './invoices.service';

describe('InvoicesService', () => {
  let prisma: MockPrismaService;
  let service: InvoicesService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new InvoicesService(prisma as unknown as PrismaService);
  });

  describe('listForWorkspace', () => {
    it('lists invoices ordered by issueDate desc', async () => {
      prisma.invoice.findMany.mockResolvedValue([]);

      await service.listForWorkspace('ws-1');

      expect(prisma.invoice.findMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1' },
        orderBy: { issueDate: 'desc' },
        include: { targetPlan: { select: { id: true, name: true, slug: true } } },
      });
    });
  });

  describe('recordProviderInvoice', () => {
    it('generates a sequential PS- number based on the existing count', async () => {
      prisma.invoice.count.mockResolvedValue(3);
      prisma.invoice.create.mockResolvedValue({ id: 'inv-1' });

      await service.recordProviderInvoice({
        workspaceId: 'ws-1',
        subscriptionId: 'sub-1',
        amount: 190000,
        currency: 'USD',
        status: InvoiceStatus.PAID,
        provider: 'paystack',
        providerInvoiceId: 'txn-abc',
        paidAt: new Date('2026-08-13T00:00:00.000Z'),
      });

      expect(prisma.invoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          subscriptionId: 'sub-1',
          number: 'PS-0004',
          amount: 190000,
          currency: 'USD',
          status: InvoiceStatus.PAID,
          provider: 'paystack',
          providerInvoiceId: 'txn-abc',
        }),
      });
    });

    it('starts numbering at PS-0001 for a workspace with no invoices yet', async () => {
      prisma.invoice.count.mockResolvedValue(0);
      prisma.invoice.create.mockResolvedValue({ id: 'inv-1' });

      await service.recordProviderInvoice({
        workspaceId: 'ws-1',
        subscriptionId: null,
        amount: 190000,
        currency: 'USD',
        status: InvoiceStatus.UNCOLLECTIBLE,
        provider: 'paystack',
        failureReason: 'Insufficient funds',
      });

      expect(prisma.invoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          number: 'PS-0001',
          failureReason: 'Insufficient funds',
        }),
      });
    });
  });

  describe('createOrReusePendingInvoice (Sprint 18A)', () => {
    it('creates a new PENDING invoice with an LQ- number when none exists yet', async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);
      prisma.invoice.count.mockResolvedValue(0);
      prisma.invoice.create.mockResolvedValue({ id: 'inv-1', status: 'PENDING' });

      await service.createOrReusePendingInvoice({
        workspaceId: 'ws-1',
        subscriptionId: 'sub-1',
        targetPlanId: 'plan-pro',
        amount: 4900,
        currency: 'USD',
        provider: 'paystack',
      });

      expect(prisma.invoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          subscriptionId: 'sub-1',
          targetPlanId: 'plan-pro',
          number: 'LQ-0001',
          amount: 4900,
          currency: 'USD',
          status: 'PENDING',
          provider: 'paystack',
        }),
      });
    });

    it('reuses (updates) an existing PENDING invoice for the same workspace+targetPlan instead of creating a duplicate', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'inv-existing',
        status: 'PENDING',
      });
      prisma.invoice.update.mockResolvedValue({
        id: 'inv-existing',
        status: 'PENDING',
      });

      await service.createOrReusePendingInvoice({
        workspaceId: 'ws-1',
        subscriptionId: 'sub-1',
        targetPlanId: 'plan-pro',
        amount: 5900, // price changed since the last attempt
        currency: 'USD',
        provider: 'paystack',
      });

      expect(prisma.invoice.create).not.toHaveBeenCalled();
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-existing' },
        data: expect.objectContaining({ amount: 5900, currency: 'USD' }),
      });
    });
  });

  describe('attachProviderReference / findByProviderReference (Sprint 18A)', () => {
    it('attaches a provider reference onto an invoice', async () => {
      prisma.invoice.update.mockResolvedValue({ id: 'inv-1' });

      await service.attachProviderReference('inv-1', 'txn-xyz');

      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { providerInvoiceId: 'txn-xyz' },
      });
    });

    it('finds an invoice by provider+reference', async () => {
      prisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1' });

      const result = await service.findByProviderReference(
        'paystack',
        'txn-xyz',
      );

      expect(prisma.invoice.findFirst).toHaveBeenCalledWith({
        where: { provider: 'paystack', providerInvoiceId: 'txn-xyz' },
      });
      expect(result).toEqual({ id: 'inv-1' });
    });
  });

  describe('markPaid / markFailed (Sprint 18A)', () => {
    it('marks an invoice PAID with the given paidAt', async () => {
      const paidAt = new Date('2026-08-18T00:00:00.000Z');
      prisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'PAID' });

      await service.markPaid('inv-1', paidAt);

      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'PAID', paidAt },
      });
    });

    it('marks an invoice FAILED with a failure reason', async () => {
      prisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'FAILED' });

      await service.markFailed('inv-1', 'Amount mismatch');

      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'FAILED', failureReason: 'Amount mismatch' },
      });
    });
  });
});
