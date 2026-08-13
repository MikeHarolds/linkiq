import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

import {
  DELIVER_WEBHOOK_JOB,
  WEBHOOK_DELIVERY_QUEUE,
  type DeliverWebhookJobData,
} from './webhook-delivery.types';

/**
 * Enqueues webhook delivery attempts — structurally identical to
 * links/queue/click-event.producer.ts and api-keys/queue/api-usage
 * .producer.ts: never awaited into the caller's request/response cycle,
 * enqueue failures are logged and swallowed rather than thrown (a
 * down/slow Redis must never break link/campaign/QR/domain/billing/
 * API-key mutations — see WebhookEventsService, the only caller).
 *
 * Automatic retry/backoff is BullMQ's own `attempts`/`backoff` engine,
 * configured here from WEBHOOK_MAX_ATTEMPTS/WEBHOOK_BACKOFF_BASE_MS —
 * reusing the exact mechanism ClickEventProducer already relies on
 * rather than hand-rolling a scheduler (see
 * docs/architecture/webhooks.md §Retries).
 */
@Injectable()
export class WebhookDeliveryProducer {
  private readonly logger = new Logger(WebhookDeliveryProducer.name);

  constructor(
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly queue: Queue<DeliverWebhookJobData>,
    private readonly config: ConfigService,
  ) {}

  /** `attempts` lets a caller override the queue's default — used by
   * manual retry (§23) to enqueue exactly one additional attempt rather
   * than a fresh full automatic-retry cascade. */
  enqueue(data: DeliverWebhookJobData, attempts?: number): void {
    const maxAttempts =
      attempts ?? this.config.get<number>('webhooks.maxAttempts') ?? 5;
    const backoffBaseMs =
      this.config.get<number>('webhooks.backoffBaseMs') ?? 1000;

    this.queue
      .add(DELIVER_WEBHOOK_JOB, data, {
        attempts: maxAttempts,
        backoff: { type: 'exponential', delay: backoffBaseMs },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to enqueue webhook delivery ${data.deliveryId}: ${String(error)}`,
        );
      });
  }
}
