import { WebhookDeliveryStatus, WebhookEndpointStatus } from '@prisma/client';
import type { Job } from 'bullmq';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../test/mocks/prisma.mock';
import type { AuditService } from '../../audit/audit.service';
import type { WebhookSecretCipherService } from '../security/webhook-secret-cipher.service';
import type { WebhookUrlGuard } from '../security/webhook-url-guard';
import type { WebhookSignatureService } from '../webhook-signature.service';

import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import type { DeliverWebhookJobData } from './webhook-delivery.types';

function makeJob(
  data: DeliverWebhookJobData,
  { attemptsMade = 0, attempts = 5 } = {},
): Job<DeliverWebhookJobData> {
  return {
    id: 'job-1',
    data,
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<DeliverWebhookJobData>;
}

function makeDeliveryWithRelations(
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id: 'delivery-1',
    webhookEndpointId: 'endpoint-1',
    eventId: 'evt_abc',
    eventType: 'LINK_CREATED',
    attemptCount: 0,
    status: WebhookDeliveryStatus.PENDING,
    webhookEndpoint: {
      id: 'endpoint-1',
      workspaceId: 'ws-1',
      url: 'https://example.com/webhook',
      secretCiphertext: 'ciphertext(whsec_test)',
      status: WebhookEndpointStatus.ACTIVE,
      deletedAt: null,
      consecutiveFailures: 0,
    },
    event: {
      id: 'evt_abc',
      workspaceId: 'ws-1',
      type: 'LINK_CREATED',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      payload: { id: 'link-1' },
    },
    ...overrides,
  };
}

describe('WebhookDeliveryProcessor', () => {
  let prisma: MockPrismaService;
  let config: { get: jest.Mock };
  let urlGuard: { assertSafe: jest.Mock };
  let secretCipher: { decrypt: jest.Mock };
  let signature: { sign: jest.Mock };
  let audit: { record: jest.Mock };
  let processor: WebhookDeliveryProcessor;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    prisma = createMockPrismaService();
    config = {
      get: jest.fn((key: string) => {
        if (key === 'webhooks.timeoutMs') return 5000;
        if (key === 'webhooks.autoDisableThreshold') return 10;
        return undefined;
      }),
    };
    urlGuard = { assertSafe: jest.fn().mockResolvedValue(undefined) };
    secretCipher = { decrypt: jest.fn().mockReturnValue('whsec_test') };
    signature = { sign: jest.fn().mockReturnValue('sha256=deadbeef') };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    prisma.webhookDelivery.update.mockResolvedValue({});
    prisma.webhookEndpoint.update.mockResolvedValue({
      id: 'endpoint-1',
      workspaceId: 'ws-1',
      consecutiveFailures: 1,
      status: WebhookEndpointStatus.ACTIVE,
    });
    prisma.$transaction.mockImplementation(
      async (ops: unknown) =>
        Array.isArray(ops) ? Promise.all(ops) : ops,
    );

    processor = new WebhookDeliveryProcessor(
      prisma as unknown as never,
      config as unknown as never,
      urlGuard as unknown as WebhookUrlGuard,
      secretCipher as unknown as WebhookSecretCipherService,
      signature as unknown as WebhookSignatureService,
      audit as unknown as AuditService,
    );

    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('discards a job whose delivery no longer exists (no HTTP attempted)', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(null);

    await processor.process(makeJob({ deliveryId: 'missing' }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not attempt HTTP when the endpoint has been paused since enqueue', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(
      makeDeliveryWithRelations({
        webhookEndpoint: {
          id: 'endpoint-1',
          workspaceId: 'ws-1',
          url: 'https://example.com/webhook',
          secretCiphertext: 'ciphertext(whsec_test)',
          status: WebhookEndpointStatus.PAUSED,
          deletedAt: null,
          consecutiveFailures: 0,
        },
      }),
    );

    await processor.process(makeJob({ deliveryId: 'delivery-1' }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: WebhookDeliveryStatus.FAILED }),
      }),
    );
  });

  it('does not attempt HTTP when the endpoint was deleted since enqueue', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(
      makeDeliveryWithRelations({
        webhookEndpoint: {
          id: 'endpoint-1',
          workspaceId: 'ws-1',
          url: 'https://example.com/webhook',
          secretCiphertext: 'ciphertext(whsec_test)',
          status: WebhookEndpointStatus.ACTIVE,
          deletedAt: new Date(),
          consecutiveFailures: 0,
        },
      }),
    );

    await processor.process(makeJob({ deliveryId: 'delivery-1' }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks delivery and never calls fetch when the SSRF guard rejects the URL (defense in depth)', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(makeDeliveryWithRelations());
    urlGuard.assertSafe.mockRejectedValue(new Error('blocked: private address'));

    await processor.process(makeJob({ deliveryId: 'delivery-1' }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: WebhookDeliveryStatus.EXHAUSTED }),
      }),
    );
  });

  it('on a 2xx response, marks the delivery DELIVERED and resets consecutiveFailures', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(makeDeliveryWithRelations());
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);

    await processor.process(makeJob({ deliveryId: 'delivery-1' }));

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: WebhookDeliveryStatus.DELIVERED }),
      }),
    );
    expect(prisma.webhookEndpoint.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFailures: 0 }),
      }),
    );
  });

  it('signs the request over the exact envelope JSON string and sends the LinkIQ signature headers', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(makeDeliveryWithRelations());
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);

    await processor.process(makeJob({ deliveryId: 'delivery-1' }));

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-LinkIQ-Event-Id': 'evt_abc',
          'X-LinkIQ-Event-Type': 'link.created',
          'X-LinkIQ-Signature': 'sha256=deadbeef',
        }),
      }),
    );
    const [, options] = fetchSpy.mock.calls[0];
    const envelope = JSON.parse(options.body);
    expect(envelope).toEqual({
      id: 'evt_abc',
      type: 'link.created',
      createdAt: '2026-01-01T00:00:00.000Z',
      workspaceId: 'ws-1',
      data: { id: 'link-1' },
    });
    expect(signature.sign).toHaveBeenCalledWith(
      'whsec_test',
      expect.any(Number),
      options.body,
    );
  });

  it('classifies a permanent 4xx (e.g. 404) as non-retryable and exhausts immediately without rethrowing', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(makeDeliveryWithRelations());
    fetchSpy.mockResolvedValue({ ok: false, status: 404 } as Response);

    await expect(
      processor.process(makeJob({ deliveryId: 'delivery-1' }, { attemptsMade: 0 })),
    ).resolves.toBeUndefined();

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: WebhookDeliveryStatus.EXHAUSTED }),
      }),
    );
  });

  it.each([408, 429, 500, 503])(
    'classifies HTTP %i as retryable and rethrows when more attempts remain',
    async (status) => {
      prisma.webhookDelivery.findUnique.mockResolvedValue(makeDeliveryWithRelations());
      fetchSpy.mockResolvedValue({ ok: false, status } as Response);

      await expect(
        processor.process(
          makeJob({ deliveryId: 'delivery-1' }, { attemptsMade: 0, attempts: 5 }),
        ),
      ).rejects.toThrow();

      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: WebhookDeliveryStatus.FAILED }),
        }),
      );
    },
  );

  it('exhausts (does not rethrow) a retryable failure once this was the final configured attempt', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(makeDeliveryWithRelations());
    fetchSpy.mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(
      processor.process(
        makeJob({ deliveryId: 'delivery-1' }, { attemptsMade: 4, attempts: 5 }),
      ),
    ).resolves.toBeUndefined();

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: WebhookDeliveryStatus.EXHAUSTED }),
      }),
    );
  });

  it('classifies a network error as retryable and rethrows when attempts remain', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(makeDeliveryWithRelations());
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      processor.process(makeJob({ deliveryId: 'delivery-1' }, { attemptsMade: 0 })),
    ).rejects.toThrow();

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WebhookDeliveryStatus.FAILED,
          failureReason: expect.stringContaining('Network error'),
        }),
      }),
    );
  });

  it('classifies a timeout/abort as retryable with a clear failure reason', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(makeDeliveryWithRelations());
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchSpy.mockRejectedValue(abortError);

    await expect(
      processor.process(makeJob({ deliveryId: 'delivery-1' }, { attemptsMade: 0 })),
    ).rejects.toThrow();

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureReason: expect.stringContaining('timed out'),
        }),
      }),
    );
  });

  it('increments attemptCount without rethrowing on a manual retry (attempts=1) that fails', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(makeDeliveryWithRelations());
    fetchSpy.mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(
      processor.process(
        makeJob({ deliveryId: 'delivery-1' }, { attemptsMade: 0, attempts: 1 }),
      ),
    ).resolves.toBeUndefined();

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WebhookDeliveryStatus.EXHAUSTED,
          attemptCount: { increment: 1 },
        }),
      }),
    );
  });

  it('auto-disables the endpoint once consecutiveFailures reaches the configured threshold', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(makeDeliveryWithRelations());
    fetchSpy.mockResolvedValue({ ok: false, status: 404 } as Response);
    prisma.webhookEndpoint.update.mockResolvedValueOnce({}).mockResolvedValueOnce({
      id: 'endpoint-1',
      workspaceId: 'ws-1',
      consecutiveFailures: 10,
      status: WebhookEndpointStatus.ACTIVE,
    });

    await processor.process(makeJob({ deliveryId: 'delivery-1' }, { attemptsMade: 0 }));

    const disableCall = prisma.webhookEndpoint.update.mock.calls.find(
      (c) => c[0].data?.status === WebhookEndpointStatus.DISABLED,
    );
    expect(disableCall).toBeDefined();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook.disabled' }),
    );
  });

  it('does not auto-disable while consecutiveFailures stays under the threshold', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue(makeDeliveryWithRelations());
    fetchSpy.mockResolvedValue({ ok: false, status: 404 } as Response);
    prisma.webhookEndpoint.update.mockResolvedValueOnce({}).mockResolvedValueOnce({
      id: 'endpoint-1',
      workspaceId: 'ws-1',
      consecutiveFailures: 3,
      status: WebhookEndpointStatus.ACTIVE,
    });

    await processor.process(makeJob({ deliveryId: 'delivery-1' }, { attemptsMade: 0 }));

    const disableCall = prisma.webhookEndpoint.update.mock.calls.find(
      (c) => c[0].data?.status === WebhookEndpointStatus.DISABLED,
    );
    expect(disableCall).toBeUndefined();
  });
});
