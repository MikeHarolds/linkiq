import { createHash } from 'crypto';

import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';

import { Public } from '../../../../common/decorators/public.decorator';
import { BillingEventsService } from '../../billing-events.service';

import { PaystackSignatureService } from './paystack-signature.service';
import { PaystackWebhookProducer } from './queue/paystack-webhook.producer';

interface PaystackWebhookBody {
  event?: string;
  data?: unknown;
}

/**
 * The inbound Paystack webhook receiver — NOT Sprint 9's outbound
 * webhook system (LinkIQ -> third party). This is Paystack -> LinkIQ,
 * a different, unrelated pipe that happens to share only the general
 * "HMAC-verify, then process async" shape. Public (Paystack can't send
 * a LinkIQ session token), authenticated purely by signature.
 *
 * Deliberately thin: verify signature -> record for idempotency ->
 * enqueue -> ack 200 immediately (Paystack's own guidance: acknowledge
 * fast, do the real work after). All state-transition logic lives in
 * PaystackWebhookProcessor, off the request path.
 */
@ApiTags('webhooks-paystack')
@Controller('webhooks/paystack')
export class PaystackWebhookController {
  private readonly logger = new Logger(PaystackWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly signature: PaystackSignatureService,
    private readonly billingEvents: BillingEventsService,
    private readonly producer: PaystackWebhookProducer,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Inbound Paystack webhook receiver (public, signature-verified)',
  })
  @ApiResponse({ status: 200, description: 'Acknowledged' })
  @ApiResponse({ status: 401, description: 'Invalid or missing signature' })
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
  ): Promise<{ received: boolean }> {
    const rawBody = req.rawBody;
    const secretKey = this.config.get<string>('paystack.secretKey') ?? '';

    if (!rawBody || !this.signature.verify(secretKey, rawBody, signature)) {
      // Nothing persisted, nothing logged beyond a warning — never echo
      // the signature/body of a rejected request into logs.
      this.logger.warn('Rejected Paystack webhook: invalid signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const body = req.body as PaystackWebhookBody;
    const eventType = body.event ?? 'unknown';

    // Paystack does not send a wrapper-level unique event id in every
    // payload (confirmed absent from official docs at research time —
    // see docs/architecture/paystack-integration.md §Security). Hashing
    // the exact raw bytes is a safe, provider-confirmed-data-only
    // idempotency key: a byte-identical redelivery (Paystack's own retry
    // behavior on a missed ack) hashes the same and is correctly
    // deduped, while any genuinely different event — even for the same
    // underlying resource — hashes differently and is correctly
    // processed. This deliberately avoids relying on `data.id`, which
    // stays constant across a resource's own state transitions (e.g.
    // successive invoice.update events) and would wrongly collide.
    const externalEventId = createHash('sha256').update(rawBody).digest('hex');

    const { event, isNew } = await this.billingEvents.recordEvent({
      provider: 'paystack',
      externalEventId,
      eventType,
      payload: body as unknown as Prisma.InputJsonValue,
    });

    if (isNew) {
      this.producer.enqueue({ billingEventId: event.id });
    }

    return { received: true };
  }
}
