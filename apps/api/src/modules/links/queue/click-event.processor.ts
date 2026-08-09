import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service';

import {
  CLICK_EVENT_QUEUE,
  type RecordClickJobData,
} from './click-event.types';

/**
 * Consumes click events off the queue and writes them to the database.
 * This is the ONLY place ClickEvent rows are created — deliberately kept
 * out of the request/response cycle of a redirect (see
 * click-event.producer.ts) so a slow write here has zero effect on
 * redirect latency. This processor is the seam Sprint 3's analytics
 * engine builds on: today it only persists the raw event; aggregation,
 * geo lookup, bot filtering, etc. can be added here without touching the
 * redirect path at all.
 */
@Processor(CLICK_EVENT_QUEUE)
export class ClickEventProcessor extends WorkerHost {
  private readonly logger = new Logger(ClickEventProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<RecordClickJobData>): Promise<void> {
    const { linkId, workspaceId, occurredAt, ipAddress, userAgent, referer } =
      job.data;

    try {
      await this.prisma.clickEvent.create({
        data: {
          linkId,
          workspaceId,
          occurredAt: new Date(occurredAt),
          ipAddress,
          userAgent,
          referer,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record click for link ${linkId}: ${String(error)}`,
      );
      throw error; // let BullMQ apply its retry policy
    }
  }
}
