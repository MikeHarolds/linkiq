import { NotFoundException } from '@nestjs/common';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../../common/decorators/request-context.decorator';
import type { WebhooksService } from '../../webhooks/webhooks.service';

import { AdminWebhooksService } from './admin-webhooks.service';

describe('AdminWebhooksService', () => {
  let prisma: MockPrismaService;
  let webhooks: {
    listDeliveries: jest.Mock;
    getDeliveryOrThrow: jest.Mock;
    retryDelivery: jest.Mock;
  };
  let service: AdminWebhooksService;
  const ctx: RequestContext = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  beforeEach(() => {
    prisma = createMockPrismaService();
    webhooks = {
      listDeliveries: jest
        .fn()
        .mockResolvedValue({ items: [], pagination: {} }),
      getDeliveryOrThrow: jest.fn().mockResolvedValue({ id: 'd1' }),
      retryDelivery: jest
        .fn()
        .mockResolvedValue({ id: 'd1', status: 'PENDING' }),
    };
    service = new AdminWebhooksService(
      prisma as unknown as never,
      webhooks as unknown as WebhooksService,
    );
  });

  describe('endpoint resolution', () => {
    it('throws NotFoundException when the endpoint does not exist', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(null);
      await expect(service.listDeliveries('missing', 1, 20)).rejects.toThrow(
        NotFoundException,
      );
      expect(webhooks.listDeliveries).not.toHaveBeenCalled();
    });
  });

  describe('retryDelivery', () => {
    it('never implements its own retry logic — always delegates to the real WebhooksService', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue({
        workspaceId: 'ws1',
      });

      await service.retryDelivery('ep1', 'd1', 'admin1', ctx);

      expect(webhooks.retryDelivery).toHaveBeenCalledWith(
        'ws1',
        'ep1',
        'd1',
        'admin1',
        ctx,
      );
    });
  });

  describe('listDeliveries / getDelivery', () => {
    it('resolves workspaceId from the endpoint, then delegates', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue({
        workspaceId: 'ws1',
      });

      await service.listDeliveries('ep1', 1, 20, 'FAILED' as never);
      expect(webhooks.listDeliveries).toHaveBeenCalledWith('ws1', 'ep1', {
        page: 1,
        pageSize: 20,
        status: 'FAILED',
      });

      await service.getDelivery('ep1', 'd1');
      expect(webhooks.getDeliveryOrThrow).toHaveBeenCalledWith(
        'ws1',
        'ep1',
        'd1',
      );
    });
  });

  describe('getOverview', () => {
    it('computes success rate from terminal delivery statuses only', async () => {
      prisma.webhookEndpoint.count.mockResolvedValue(0);
      prisma.webhookDelivery.groupBy.mockResolvedValue([
        { status: 'DELIVERED', _count: { _all: 8 } },
        { status: 'FAILED', _count: { _all: 2 } },
        { status: 'PENDING', _count: { _all: 5 } },
      ]);
      prisma.webhookEvent.findMany.mockResolvedValue([]);

      const result = await service.getOverview(new Date(), new Date());

      // 8 delivered / (8 delivered + 2 failed) terminal — PENDING excluded.
      expect(result.successRate).toBeCloseTo(0.8);
    });

    it('reports a null success rate when there are no terminal deliveries yet', async () => {
      prisma.webhookEndpoint.count.mockResolvedValue(0);
      prisma.webhookDelivery.groupBy.mockResolvedValue([
        { status: 'PENDING', _count: { _all: 3 } },
      ]);
      prisma.webhookEvent.findMany.mockResolvedValue([]);

      const result = await service.getOverview(new Date(), new Date());
      expect(result.successRate).toBeNull();
    });

    it('never selects or returns a webhook signing secret', async () => {
      prisma.webhookEndpoint.count.mockResolvedValue(0);
      prisma.webhookDelivery.groupBy.mockResolvedValue([]);
      prisma.webhookEvent.findMany.mockResolvedValue([]);

      const result = await service.getOverview(new Date(), new Date());
      expect(JSON.stringify(result)).not.toContain('secret');
    });
  });
});
