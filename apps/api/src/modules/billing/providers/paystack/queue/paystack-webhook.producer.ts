import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

import {
  PAYSTACK_WEBHOOK_QUEUE,
  PROCESS_PAYSTACK_WEBHOOK_JOB,
  type ProcessPaystackWebhookJobData,
} from './paystack-webhook.types';

/**
 * Enqueues Paystack webhook processing — structurally identical to
 * WebhookDeliveryProducer (Sprint 9): never awaited into the controller's
 * request/response cycle (the controller must ack Paystack fast, per
 * Paystack's own guidance), enqueue failures are logged and swallowed
 * rather than thrown. A failed enqueue here means a received-and-recorded
 * BillingEvent never gets processed into a state transition — acceptable
 * for a foundation sprint (the same failure mode Sprint 9's producer
 * accepts), not something this sprint adds new recovery tooling for.
 */
@Injectable()
export class PaystackWebhookProducer {
  private readonly logger = new Logger(PaystackWebhookProducer.name);

  constructor(
    @InjectQueue(PAYSTACK_WEBHOOK_QUEUE)
    private readonly queue: Queue<ProcessPaystackWebhookJobData>,
  ) {}

  enqueue(data: ProcessPaystackWebhookJobData): void {
    this.queue
      .add(PROCESS_PAYSTACK_WEBHOOK_JOB, data, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Failed to enqueue Paystack webhook processing for billing event ${data.billingEventId}: ${String(error)}`,
        );
      });
  }
}
