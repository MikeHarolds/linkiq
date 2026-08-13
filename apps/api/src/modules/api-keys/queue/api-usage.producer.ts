import { randomUUID } from 'crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

import {
  API_USAGE_QUEUE,
  RECORD_API_USAGE_JOB,
  type RecordApiUsageJobData,
} from './api-usage.types';

type EnqueueInput = Omit<RecordApiUsageJobData, 'eventId'>;

/**
 * Enqueues API usage events for asynchronous processing — a direct
 * structural copy of links/queue/click-event.producer.ts. Never awaited
 * into the request/response cycle (see ApiUsageInterceptor, the only
 * caller): a slow or backed-up usage-tracking pipeline must never add
 * latency to an API response, exactly like a redirect never waits on
 * click-event processing.
 */
@Injectable()
export class ApiUsageProducer {
  private readonly logger = new Logger(ApiUsageProducer.name);

  constructor(
    @InjectQueue(API_USAGE_QUEUE)
    private readonly queue: Queue<RecordApiUsageJobData>,
  ) {}

  enqueue(input: EnqueueInput): void {
    const eventId = randomUUID();
    const data: RecordApiUsageJobData = { ...input, eventId };

    this.queue
      .add(RECORD_API_USAGE_JOB, data, {
        jobId: eventId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      })
      .catch((error: unknown) => {
        this.logger.warn(`Failed to enqueue API usage event: ${String(error)}`);
      });
  }
}
