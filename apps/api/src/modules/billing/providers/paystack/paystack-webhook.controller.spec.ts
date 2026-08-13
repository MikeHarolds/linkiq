import { createHmac } from 'crypto';

import { UnauthorizedException } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { BillingEventsService } from '../../billing-events.service';

import { PaystackSignatureService } from './paystack-signature.service';
import { PaystackWebhookController } from './paystack-webhook.controller';
import type { PaystackWebhookProducer } from './queue/paystack-webhook.producer';

const SECRET_KEY = 'sk_test_secret';

function makeRequest(bodyObject: unknown): RawBodyRequest<Request> {
  const rawBody = Buffer.from(JSON.stringify(bodyObject), 'utf8');
  return {
    rawBody,
    body: bodyObject,
    headers: {},
  } as unknown as RawBodyRequest<Request>;
}

function signatureFor(rawBody: Buffer, secret = SECRET_KEY): string {
  return createHmac('sha512', secret).update(rawBody).digest('hex');
}

describe('PaystackWebhookController', () => {
  let config: { get: jest.Mock };
  let billingEvents: jest.Mocked<Pick<BillingEventsService, 'recordEvent'>>;
  let producer: jest.Mocked<Pick<PaystackWebhookProducer, 'enqueue'>>;
  let controller: PaystackWebhookController;

  beforeEach(() => {
    config = { get: jest.fn().mockReturnValue(SECRET_KEY) };
    billingEvents = { recordEvent: jest.fn() };
    producer = { enqueue: jest.fn() };
    controller = new PaystackWebhookController(
      config as unknown as ConfigService,
      new PaystackSignatureService(),
      billingEvents as unknown as BillingEventsService,
      producer as unknown as PaystackWebhookProducer,
    );
  });

  it('rejects a request with no signature header', async () => {
    const req = makeRequest({ event: 'charge.success', data: {} });

    await expect(controller.receive(req, undefined)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(billingEvents.recordEvent).not.toHaveBeenCalled();
  });

  it('rejects a request with a signature computed from the wrong secret', async () => {
    const req = makeRequest({ event: 'charge.success', data: {} });
    const badSignature = signatureFor(req.rawBody!, 'sk_test_wrong');

    await expect(controller.receive(req, badSignature)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(billingEvents.recordEvent).not.toHaveBeenCalled();
  });

  it('rejects a request with no captured rawBody', async () => {
    const req = {
      rawBody: undefined,
      body: { event: 'charge.success' },
    } as unknown as RawBodyRequest<Request>;

    await expect(controller.receive(req, 'anything')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a validly-signed request and records the event', async () => {
    const bodyObject = {
      event: 'charge.success',
      data: { reference: 'txn-abc' },
    };
    const req = makeRequest(bodyObject);
    const signature = signatureFor(req.rawBody!);
    billingEvents.recordEvent.mockResolvedValue({
      event: { id: 'billing-event-1' } as never,
      isNew: true,
    });

    const result = await controller.receive(req, signature);

    expect(result).toEqual({ received: true });
    expect(billingEvents.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'paystack',
        eventType: 'charge.success',
      }),
    );
    expect(producer.enqueue).toHaveBeenCalledWith({
      billingEventId: 'billing-event-1',
    });
  });

  it('does not enqueue a duplicate (isNew: false) event', async () => {
    const bodyObject = { event: 'charge.success', data: {} };
    const req = makeRequest(bodyObject);
    const signature = signatureFor(req.rawBody!);
    billingEvents.recordEvent.mockResolvedValue({
      event: { id: 'billing-event-1' } as never,
      isNew: false,
    });

    const result = await controller.receive(req, signature);

    expect(result).toEqual({ received: true });
    expect(producer.enqueue).not.toHaveBeenCalled();
  });

  it('computes the same externalEventId for byte-identical redeliveries', async () => {
    const bodyObject = {
      event: 'charge.success',
      data: { reference: 'txn-abc' },
    };
    const req1 = makeRequest(bodyObject);
    const req2 = makeRequest(bodyObject);
    const signature1 = signatureFor(req1.rawBody!);
    const signature2 = signatureFor(req2.rawBody!);
    billingEvents.recordEvent.mockResolvedValue({
      event: { id: 'billing-event-1' } as never,
      isNew: true,
    });

    await controller.receive(req1, signature1);
    await controller.receive(req2, signature2);

    const [firstCall] = billingEvents.recordEvent.mock.calls[0]!;
    const [secondCall] = billingEvents.recordEvent.mock.calls[1]!;
    expect(firstCall.externalEventId).toBe(secondCall.externalEventId);
  });

  it('falls back to "unknown" eventType when the event field is missing', async () => {
    const bodyObject = { data: {} };
    const req = makeRequest(bodyObject);
    const signature = signatureFor(req.rawBody!);
    billingEvents.recordEvent.mockResolvedValue({
      event: { id: 'billing-event-1' } as never,
      isNew: true,
    });

    await controller.receive(req, signature);

    expect(billingEvents.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'unknown' }),
    );
  });
});
