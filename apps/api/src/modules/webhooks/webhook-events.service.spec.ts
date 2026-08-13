import { WebhookEndpointStatus, WebhookEventType } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';

import type { WebhookDeliveryProducer } from './queue/webhook-delivery.producer';
import { WebhookEventsService } from './webhook-events.service';

describe('WebhookEventsService', () => {
  let prisma: MockPrismaService;
  let producer: { enqueue: jest.Mock };
  let service: WebhookEventsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    producer = { enqueue: jest.fn() };
    service = new WebhookEventsService(
      prisma as unknown as never,
      producer as unknown as WebhookDeliveryProducer,
    );
  });

  it('creates one immutable WebhookEvent row per emit() call', async () => {
    prisma.webhookEvent.create.mockResolvedValue({
      id: 'evt_abc',
      workspaceId: 'ws-1',
      type: WebhookEventType.LINK_CREATED,
    });
    prisma.webhookEndpoint.findMany.mockResolvedValue([]);

    await service.emit({
      type: WebhookEventType.LINK_CREATED,
      workspaceId: 'ws-1',
      resourceId: 'link-1',
      data: { id: 'link-1' },
    });

    expect(prisma.webhookEvent.create).toHaveBeenCalledTimes(1);
    const createCall = prisma.webhookEvent.create.mock.calls[0][0];
    expect(createCall.data.id).toMatch(/^evt_/);
    expect(createCall.data.workspaceId).toBe('ws-1');
    expect(createCall.data.type).toBe(WebhookEventType.LINK_CREATED);
  });

  it('only matches ACTIVE, non-deleted endpoints subscribed to this exact event type', async () => {
    prisma.webhookEvent.create.mockResolvedValue({
      id: 'evt_abc',
      workspaceId: 'ws-1',
      type: WebhookEventType.LINK_CREATED,
    });
    prisma.webhookEndpoint.findMany.mockResolvedValue([]);

    await service.emit({
      type: WebhookEventType.LINK_CREATED,
      workspaceId: 'ws-1',
      data: {},
    });

    expect(prisma.webhookEndpoint.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'ws-1',
          status: WebhookEndpointStatus.ACTIVE,
          deletedAt: null,
          events: { has: WebhookEventType.LINK_CREATED },
        }),
      }),
    );
  });

  it('creates one WebhookDelivery row and enqueues one job per matching endpoint (fan-out)', async () => {
    prisma.webhookEvent.create.mockResolvedValue({
      id: 'evt_abc',
      workspaceId: 'ws-1',
      type: WebhookEventType.LINK_CREATED,
    });
    prisma.webhookEndpoint.findMany.mockResolvedValue([
      { id: 'endpoint-1' },
      { id: 'endpoint-2' },
      { id: 'endpoint-3' },
    ]);
    prisma.webhookDelivery.create
      .mockResolvedValueOnce({ id: 'delivery-1' })
      .mockResolvedValueOnce({ id: 'delivery-2' })
      .mockResolvedValueOnce({ id: 'delivery-3' });

    await service.emit({
      type: WebhookEventType.LINK_CREATED,
      workspaceId: 'ws-1',
      data: {},
    });

    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(3);
    expect(producer.enqueue).toHaveBeenCalledTimes(3);
    expect(producer.enqueue).toHaveBeenCalledWith({ deliveryId: 'delivery-1' });
    expect(producer.enqueue).toHaveBeenCalledWith({ deliveryId: 'delivery-2' });
    expect(producer.enqueue).toHaveBeenCalledWith({ deliveryId: 'delivery-3' });
  });

  it('creates the same event ID on every delivery row it fans out to (shared, immutable event)', async () => {
    prisma.webhookEvent.create.mockResolvedValue({
      id: 'evt_shared',
      workspaceId: 'ws-1',
      type: WebhookEventType.LINK_CREATED,
    });
    prisma.webhookEndpoint.findMany.mockResolvedValue([
      { id: 'endpoint-1' },
      { id: 'endpoint-2' },
    ]);
    prisma.webhookDelivery.create.mockResolvedValue({ id: 'delivery-x' });

    await service.emit({
      type: WebhookEventType.LINK_CREATED,
      workspaceId: 'ws-1',
      data: {},
    });

    for (const call of prisma.webhookDelivery.create.mock.calls) {
      expect(call[0].data.eventId).toBe('evt_shared');
    }
  });

  it('does nothing to the delivery queue when no endpoints match', async () => {
    prisma.webhookEvent.create.mockResolvedValue({
      id: 'evt_abc',
      workspaceId: 'ws-1',
      type: WebhookEventType.LINK_CREATED,
    });
    prisma.webhookEndpoint.findMany.mockResolvedValue([]);

    await service.emit({
      type: WebhookEventType.LINK_CREATED,
      workspaceId: 'ws-1',
      data: {},
    });

    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    expect(producer.enqueue).not.toHaveBeenCalled();
  });

  it('never performs an HTTP call itself — only Postgres writes and enqueue', async () => {
    prisma.webhookEvent.create.mockResolvedValue({
      id: 'evt_abc',
      workspaceId: 'ws-1',
      type: WebhookEventType.LINK_CREATED,
    });
    prisma.webhookEndpoint.findMany.mockResolvedValue([{ id: 'endpoint-1' }]);
    prisma.webhookDelivery.create.mockResolvedValue({ id: 'delivery-1' });

    const fetchSpy = jest.spyOn(global, 'fetch');

    await service.emit({
      type: WebhookEventType.LINK_CREATED,
      workspaceId: 'ws-1',
      data: {},
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
