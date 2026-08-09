import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

import {
  CLICK_EVENT_QUEUE,
  RECORD_CLICK_JOB,
  type RecordClickJobData,
} from './click-event.types';

/**
 * Enqueues click events for asynchronous processing. Deliberately does
 * NOT await the job being processed — only that it's been accepted onto
 * the queue (a fast Redis write) — so a slow or backed-up analytics
 * pipeline can never slow down a redirect response. See
 * click-event.processor.ts for where the actual DB write happens.
 */
@Injectable()
export class ClickEventProducer {
  private readonly logger = new Logger(ClickEventProducer.name);

  constructor(
    @InjectQueue(CLICK_EVENT_QUEUE)
    private readonly queue: Queue<RecordClickJobData>,
  ) {}

  enqueue(data: RecordClickJobData): void {
    // Fire-and-forget from the redirect path's perspective: we don't
    // await this promise before responding to the redirect request. Any
    // enqueue failure is logged, never thrown — a broken analytics queue
    // must not break redirects.
    this.queue.add(RECORD_CLICK_JOB, data).catch((error: unknown) => {
      this.logger.warn(`Failed to enqueue click event: ${String(error)}`);
    });
  }
}
