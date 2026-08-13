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
});
