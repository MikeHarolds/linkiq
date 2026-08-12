import { BillingEventStatus } from '@prisma/client';

import { makeUniqueConstraintError } from '../../../test/mocks/prisma-error.mock';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { PrismaService } from '../prisma/prisma.service';

import { BillingEventsService } from './billing-events.service';

describe('BillingEventsService', () => {
  let prisma: MockPrismaService;
  let service: BillingEventsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new BillingEventsService(prisma as unknown as PrismaService);
  });

  describe('recordEvent', () => {
    it('creates a new PENDING event on first delivery', async () => {
      const created = {
        id: 'evt-1',
        provider: 'stripe',
        externalEventId: 'evt_123',
        eventType: 'invoice.paid',
        status: BillingEventStatus.PENDING,
      };
      prisma.billingEvent.create.mockResolvedValue(created);

      const result = await service.recordEvent({
        provider: 'stripe',
        externalEventId: 'evt_123',
        eventType: 'invoice.paid',
      });

      expect(result).toEqual({ event: created, isNew: true });
    });

    it('is idempotent: a duplicate (provider, externalEventId) delivery returns the existing row, not an error', async () => {
      prisma.billingEvent.create.mockRejectedValue(makeUniqueConstraintError());
      const existing = {
        id: 'evt-1',
        provider: 'stripe',
        externalEventId: 'evt_123',
        eventType: 'invoice.paid',
        status: BillingEventStatus.PROCESSED,
      };
      prisma.billingEvent.findUniqueOrThrow.mockResolvedValue(existing);

      const result = await service.recordEvent({
        provider: 'stripe',
        externalEventId: 'evt_123',
        eventType: 'invoice.paid',
      });

      expect(result).toEqual({ event: existing, isNew: false });
    });

    it('rethrows non-unique-constraint errors', async () => {
      const dbError = new Error('connection reset');
      prisma.billingEvent.create.mockRejectedValue(dbError);

      await expect(
        service.recordEvent({
          provider: 'stripe',
          externalEventId: 'evt_123',
          eventType: 'invoice.paid',
        }),
      ).rejects.toThrow('connection reset');
    });
  });

  describe('markProcessed', () => {
    it('sets status PROCESSED with a processedAt timestamp', async () => {
      await service.markProcessed('evt-1');

      expect(prisma.billingEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: expect.objectContaining({ status: BillingEventStatus.PROCESSED }),
      });
    });
  });

  describe('markFailed', () => {
    it('sets status FAILED with the error message', async () => {
      await service.markFailed('evt-1', 'boom');

      expect(prisma.billingEvent.update).toHaveBeenCalledWith({
        where: { id: 'evt-1' },
        data: expect.objectContaining({
          status: BillingEventStatus.FAILED,
          errorMessage: 'boom',
        }),
      });
    });
  });
});
