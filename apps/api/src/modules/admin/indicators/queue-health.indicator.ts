import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import type { Queue } from 'bullmq';

import { API_USAGE_QUEUE } from '../../api-keys/queue/api-usage.types';
import { PAYSTACK_WEBHOOK_QUEUE } from '../../billing/providers/paystack/queue/paystack-webhook.types';
import { CLICK_EVENT_QUEUE } from '../../links/queue/click-event.types';
import { WEBHOOK_DELIVERY_QUEUE } from '../../webhooks/queue/webhook-delivery.types';

/**
 * Real BullMQ queue depth/health — not a hardcoded "healthy" flag. Reads
 * each queue's actual job counts (waiting/active/failed/delayed) via
 * `Queue.getJobCounts()`, the same BullMQ API every existing
 * producer/processor in this codebase already relies on implicitly.
 * "Unhealthy" is defined narrowly (connection failure), not on failed-job
 * count — a queue with failed jobs is still a *responding* queue; failed
 * counts are surfaced as data for the admin UI to display, not used to
 * fail the health check itself (that would make a single flaky webhook
 * receiver take down the platform's own health status).
 */
@Injectable()
export class QueueHealthIndicator extends HealthIndicator {
  constructor(
    @InjectQueue(CLICK_EVENT_QUEUE) private readonly clickEventQueue: Queue,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly webhookDeliveryQueue: Queue,
    @InjectQueue(API_USAGE_QUEUE) private readonly apiUsageQueue: Queue,
    @InjectQueue(PAYSTACK_WEBHOOK_QUEUE)
    private readonly paystackWebhookQueue: Queue,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const queues: Array<[string, Queue]> = [
      [CLICK_EVENT_QUEUE, this.clickEventQueue],
      [WEBHOOK_DELIVERY_QUEUE, this.webhookDeliveryQueue],
      [API_USAGE_QUEUE, this.apiUsageQueue],
      [PAYSTACK_WEBHOOK_QUEUE, this.paystackWebhookQueue],
    ];

    try {
      const counts = await Promise.all(
        queues.map(
          async ([name, queue]) => [name, await queue.getJobCounts()] as const,
        ),
      );
      const details = Object.fromEntries(counts);
      return this.getStatus(key, true, details);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HealthCheckError(
        'Queue check failed',
        this.getStatus(key, false, { message }),
      );
    }
  }
}
