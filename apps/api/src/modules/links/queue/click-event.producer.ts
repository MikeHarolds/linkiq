import { randomUUID } from 'crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

import {
  CLICK_EVENT_QUEUE,
  RECORD_CLICK_JOB,
  type RecordClickJobData,
} from './click-event.types';

type EnqueueInput = Omit<RecordClickJobData, 'eventId'>;

/**
 * Enqueues click events for asynchronous processing. Deliberately does
 * NOT await the job being processed — only that it's been accepted onto
 * the queue (a fast Redis write) — so a slow or backed-up analytics
 * pipeline can never slow down a redirect response. See
 * analytics/processors/click-event.processor.ts for where the actual
 * enrichment + DB write happens.
 */
@Injectable()
export class ClickEventProducer {
  private readonly logger = new Logger(ClickEventProducer.name);

  constructor(
    @InjectQueue(CLICK_EVENT_QUEUE)
    private readonly queue: Queue<RecordClickJobData>,
  ) {}

  enqueue(input: EnqueueInput): void {
    const eventId = randomUUID();
    const data: RecordClickJobData = { ...input, eventId };

    // jobId = eventId: BullMQ itself will refuse to enqueue a second job
    // with an id already present in the queue, which is a first line of
    // defense against double-enqueueing. The processor's own idempotent
    // insert (see click-event.processor.ts) is the layer that actually
    // matters for retries of an already-running job, which BullMQ's
    // dedup does not cover.
    this.queue
      .add(RECORD_CLICK_JOB, data, {
        jobId: eventId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 24 * 60 * 60 }, // keep completed jobs 24h for debugging, then GC
        removeOnFail: { age: 7 * 24 * 60 * 60 }, // keep failed jobs a week — worth investigating
      })
      .catch((error: unknown) => {
        // Fire-and-forget from the redirect path's perspective: any
        // enqueue failure is logged, never thrown — a broken analytics
        // queue must not break redirects.
        this.logger.warn(`Failed to enqueue click event: ${String(error)}`);
      });
  }
}
