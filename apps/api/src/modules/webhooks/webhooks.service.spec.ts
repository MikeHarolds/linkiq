import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WebhookDeliveryStatus, WebhookEndpointStatus } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { AuditService } from '../audit/audit.service';
import type { BillingUsageService } from '../billing/billing-usage.service';

import type { CreateWebhookDto } from './dto/create-webhook.dto';
import type { WebhookDeliveryProducer } from './queue/webhook-delivery.producer';
import type { WebhookSecretCipherService } from './security/webhook-secret-cipher.service';
import type { WebhookUrlGuard } from './security/webhook-url-guard';
import { WebhooksService } from './webhooks.service';

const CTX: RequestContext = { ipAddress: '127.0.0.1', userAgent: 'jest' };
const WORKSPACE_ID = 'ws-1';
const OTHER_WORKSPACE_ID = 'ws-2';
const USER_ID = 'user-1';

function makeEndpointRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'endpoint-1',
    workspaceId: WORKSPACE_ID,
    name: 'My endpoint',
    url: 'https://example.com/webhook',
    secretPrefix: 'whsec_ab12cd34',
    events: ['LINK_CREATED'],
    status: WebhookEndpointStatus.ACTIVE,
    consecutiveFailures: 0,
    lastDeliveryAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    createdById: USER_ID,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDeliveryRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'delivery-1',
    webhookEndpointId: 'endpoint-1',
    eventId: 'evt_abc',
    eventType: 'LINK_CREATED',
    attemptCount: 1,
    status: WebhookDeliveryStatus.FAILED,
    responseStatus: 500,
    responseTimeMs: 120,
    lastAttemptAt: new Date(),
    nextAttemptAt: null,
    deliveredAt: null,
    failureReason: 'Receiver responded with HTTP 500',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('WebhooksService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let billingUsage: { assertCanUse: jest.Mock };
  let urlGuard: { assertSafe: jest.Mock };
  let secretCipher: { encrypt: jest.Mock; decrypt: jest.Mock };
  let producer: { enqueue: jest.Mock };
  let service: WebhooksService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    billingUsage = { assertCanUse: jest.fn().mockResolvedValue(undefined) };
    urlGuard = { assertSafe: jest.fn().mockResolvedValue(undefined) };
    secretCipher = {
      encrypt: jest.fn((raw: string) => `ciphertext(${raw})`),
      decrypt: jest.fn(),
    };
    producer = { enqueue: jest.fn() };
    service = new WebhooksService(
      prisma as unknown as never,
      audit as unknown as AuditService,
      billingUsage as unknown as BillingUsageService,
      urlGuard as unknown as WebhookUrlGuard,
      secretCipher as unknown as WebhookSecretCipherService,
      producer as unknown as WebhookDeliveryProducer,
    );
  });

  describe('create', () => {
    const dto: CreateWebhookDto = {
      name: 'My endpoint',
      url: 'https://example.com/webhook',
      events: ['link.created'],
    };

    it('validates the URL via the SSRF guard before creating anything', async () => {
      urlGuard.assertSafe.mockRejectedValue(new BadRequestException('unsafe'));

      await expect(service.create(WORKSPACE_ID, USER_ID, dto, CTX)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.webhookEndpoint.create).not.toHaveBeenCalled();
    });

    it('rejects creation when the workspace has reached its webhook-endpoint limit', async () => {
      billingUsage.assertCanUse.mockRejectedValue(new Error('PLAN_LIMIT_REACHED'));

      await expect(service.create(WORKSPACE_ID, USER_ID, dto, CTX)).rejects.toThrow(
        'PLAN_LIMIT_REACHED',
      );
      expect(prisma.webhookEndpoint.create).not.toHaveBeenCalled();
    });

    it('stores an encrypted ciphertext, never the raw secret or a hash', async () => {
      prisma.webhookEndpoint.create.mockResolvedValue(makeEndpointRow());

      await service.create(WORKSPACE_ID, USER_ID, dto, CTX);

      const createCall = prisma.webhookEndpoint.create.mock.calls[0][0];
      expect(createCall.data.secretCiphertext).toMatch(/^ciphertext\(whsec_/);
      expect(createCall.data).not.toHaveProperty('secretHash');
      expect(createCall.data).not.toHaveProperty('secret');
    });

    it('returns the raw secret exactly once in the create response', async () => {
      prisma.webhookEndpoint.create.mockResolvedValue(makeEndpointRow());

      const result = await service.create(WORKSPACE_ID, USER_ID, dto, CTX);

      expect(result.secret).toMatch(/^whsec_/);
      expect(result).not.toHaveProperty('secretCiphertext');
    });

    it('translates wire-format event names to Prisma enum values on write', async () => {
      prisma.webhookEndpoint.create.mockResolvedValue(makeEndpointRow());

      await service.create(WORKSPACE_ID, USER_ID, dto, CTX);

      const createCall = prisma.webhookEndpoint.create.mock.calls[0][0];
      expect(createCall.data.events).toEqual(['LINK_CREATED']);
    });

    it('records an audit event without leaking the secret in metadata', async () => {
      prisma.webhookEndpoint.create.mockResolvedValue(makeEndpointRow());

      await service.create(WORKSPACE_ID, USER_ID, dto, CTX);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'webhook.created' }),
      );
      const auditCall = audit.record.mock.calls[0][0];
      expect(JSON.stringify(auditCall)).not.toMatch(/whsec_/);
    });
  });

  describe('workspace isolation', () => {
    it('findByIdOrThrow 404s when the endpoint belongs to a different workspace', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(null);

      await expect(
        service.findByIdOrThrow(OTHER_WORKSPACE_ID, 'endpoint-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.webhookEndpoint.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'endpoint-1',
            workspaceId: OTHER_WORKSPACE_ID,
          }),
        }),
      );
    });

    it('findByIdOrThrow 404s for a soft-deleted endpoint', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(null);

      await expect(
        service.findByIdOrThrow(WORKSPACE_ID, 'endpoint-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll / findByIdOrThrow response shape', () => {
    it('never includes secretCiphertext in a list response', async () => {
      prisma.webhookEndpoint.findMany.mockResolvedValue([makeEndpointRow()]);

      const result = await service.findAll(WORKSPACE_ID);

      expect(result[0]).not.toHaveProperty('secretCiphertext');
      expect(result[0]).not.toHaveProperty('secret');
    });

    it('translates stored enum event values back to dotted wire names', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(
        makeEndpointRow({ events: ['LINK_CREATED', 'CAMPAIGN_DELETED'] }),
      );

      const result = await service.findByIdOrThrow(WORKSPACE_ID, 'endpoint-1');

      expect(result.events).toEqual(['link.created', 'campaign.deleted']);
    });
  });

  describe('pause / activate', () => {
    it('rejects pausing an already-paused endpoint', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(
        makeEndpointRow({ status: WebhookEndpointStatus.PAUSED }),
      );

      await expect(
        service.pause(WORKSPACE_ID, 'endpoint-1', USER_ID, CTX),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.webhookEndpoint.update).not.toHaveBeenCalled();
    });

    it('rejects activating an already-active endpoint', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(
        makeEndpointRow({ status: WebhookEndpointStatus.ACTIVE }),
      );

      await expect(
        service.activate(WORKSPACE_ID, 'endpoint-1', USER_ID, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('resets consecutiveFailures to 0 on activate', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(
        makeEndpointRow({
          status: WebhookEndpointStatus.DISABLED,
          consecutiveFailures: 12,
        }),
      );
      prisma.webhookEndpoint.update.mockResolvedValue(
        makeEndpointRow({ status: WebhookEndpointStatus.ACTIVE, consecutiveFailures: 0 }),
      );

      await service.activate(WORKSPACE_ID, 'endpoint-1', USER_ID, CTX);

      expect(prisma.webhookEndpoint.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WebhookEndpointStatus.ACTIVE,
            consecutiveFailures: 0,
          }),
        }),
      );
    });

    it('does not delete delivery history on pause (only flips status)', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(makeEndpointRow());
      prisma.webhookEndpoint.update.mockResolvedValue(
        makeEndpointRow({ status: WebhookEndpointStatus.PAUSED }),
      );

      await service.pause(WORKSPACE_ID, 'endpoint-1', USER_ID, CTX);

      expect(prisma.webhookDelivery.update).not.toHaveBeenCalled();
      const updateCall = prisma.webhookEndpoint.update.mock.calls[0][0];
      expect(Object.keys(updateCall.data)).toEqual(['status']);
    });
  });

  describe('rotateSecret', () => {
    it('generates a brand new secret and encrypts it, replacing the stored ciphertext', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(makeEndpointRow());
      prisma.webhookEndpoint.update.mockResolvedValue(makeEndpointRow());

      const result = await service.rotateSecret(
        WORKSPACE_ID,
        'endpoint-1',
        USER_ID,
        CTX,
      );

      expect(result.secret).toMatch(/^whsec_/);
      const updateCall = prisma.webhookEndpoint.update.mock.calls[0][0];
      expect(updateCall.data.secretCiphertext).toMatch(/^ciphertext\(whsec_/);
    });

    it('audits the rotation without leaking the new secret', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(makeEndpointRow());
      prisma.webhookEndpoint.update.mockResolvedValue(makeEndpointRow());

      await service.rotateSecret(WORKSPACE_ID, 'endpoint-1', USER_ID, CTX);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'webhook.secret_rotated' }),
      );
      const auditCall = audit.record.mock.calls[0][0];
      expect(JSON.stringify(auditCall)).not.toMatch(/whsec_[A-Za-z0-9_-]{10,}/);
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt rather than issuing a hard delete', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(makeEndpointRow());

      await service.softDelete(WORKSPACE_ID, 'endpoint-1', USER_ID, CTX);

      expect(prisma.webhookEndpoint.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('retryDelivery', () => {
    it('rejects retrying on a paused/disabled endpoint', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(
        makeEndpointRow({ status: WebhookEndpointStatus.PAUSED }),
      );

      await expect(
        service.retryDelivery(WORKSPACE_ID, 'endpoint-1', 'delivery-1', USER_ID, CTX),
      ).rejects.toThrow(BadRequestException);
      expect(producer.enqueue).not.toHaveBeenCalled();
    });

    it('404s when the delivery does not belong to this endpoint', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(makeEndpointRow());
      prisma.webhookDelivery.findFirst.mockResolvedValue(null);

      await expect(
        service.retryDelivery(WORKSPACE_ID, 'endpoint-1', 'delivery-1', USER_ID, CTX),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects retrying a delivery that is still PENDING/PROCESSING/DELIVERED', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(makeEndpointRow());
      prisma.webhookDelivery.findFirst.mockResolvedValue(
        makeDeliveryRow({ status: WebhookDeliveryStatus.DELIVERED }),
      );

      await expect(
        service.retryDelivery(WORKSPACE_ID, 'endpoint-1', 'delivery-1', USER_ID, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it('enqueues exactly one attempt (attempts=1), not a fresh auto-retry cascade', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(makeEndpointRow());
      prisma.webhookDelivery.findFirst.mockResolvedValue(
        makeDeliveryRow({ status: WebhookDeliveryStatus.EXHAUSTED }),
      );

      await service.retryDelivery(WORKSPACE_ID, 'endpoint-1', 'delivery-1', USER_ID, CTX);

      expect(producer.enqueue).toHaveBeenCalledWith({ deliveryId: 'delivery-1' }, 1);
    });

    it('resets the delivery to PENDING without creating a second delivery row', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(makeEndpointRow());
      prisma.webhookDelivery.findFirst.mockResolvedValue(
        makeDeliveryRow({ status: WebhookDeliveryStatus.FAILED }),
      );

      await service.retryDelivery(WORKSPACE_ID, 'endpoint-1', 'delivery-1', USER_ID, CTX);

      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: { status: WebhookDeliveryStatus.PENDING },
      });
      expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    });
  });

  describe('sendTestEvent', () => {
    it('creates a WEBHOOK_TEST event/delivery targeting only this endpoint and enqueues it', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(makeEndpointRow());
      prisma.webhookEvent.create.mockResolvedValue({ id: 'evt_test123' });
      prisma.webhookDelivery.create.mockResolvedValue({ id: 'delivery-test' });

      const result = await service.sendTestEvent(WORKSPACE_ID, 'endpoint-1', USER_ID);

      expect(prisma.webhookEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'WEBHOOK_TEST' }),
        }),
      );
      expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            webhookEndpointId: 'endpoint-1',
            eventType: 'WEBHOOK_TEST',
          }),
        }),
      );
      expect(producer.enqueue).toHaveBeenCalledWith({ deliveryId: 'delivery-test' });
      expect(result).toEqual({ eventId: 'evt_test123', deliveryId: 'delivery-test' });
    });
  });
});
