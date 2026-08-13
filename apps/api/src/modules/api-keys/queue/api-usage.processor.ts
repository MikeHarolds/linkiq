import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { isUniqueConstraintViolation } from '../../../common/utils/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';

import { API_USAGE_QUEUE, type RecordApiUsageJobData } from './api-usage.types';

/**
 * Consumes API usage events off the queue and persists them — a direct
 * structural copy of analytics/processors/click-event.processor.ts, kept
 * out of the request/response cycle for the same reason (see
 * ApiUsageProducer). Idempotency: `job.data.eventId` is the ApiUsageEvent
 * primary key, so a retried job's insert fails on the unique constraint
 * instead of double-counting toward MONTHLY_API_REQUESTS.
 */
@Processor(API_USAGE_QUEUE, { concurrency: 5 })
@Injectable()
export class ApiUsageProcessor extends WorkerHost {
  private readonly logger = new Logger(ApiUsageProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<RecordApiUsageJobData>): Promise<void> {
    const {
      eventId,
      workspaceId,
      apiKeyId,
      endpoint,
      method,
      statusCode,
      durationMs,
    } = job.data;

    if (!eventId || !workspaceId || !apiKeyId) {
      this.logger.error(
        `Discarding malformed API usage event job ${job.id}: missing required fields`,
      );
      return;
    }

    try {
      await this.prisma.apiUsageEvent.create({
        data: {
          id: eventId,
          workspaceId,
          apiKeyId,
          endpoint,
          method,
          statusCode,
          durationMs,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        this.logger.log(
          `API usage event ${eventId} already processed — skipping (idempotent retry)`,
        );
        return;
      }
      this.logger.error(
        `Failed to process API usage event ${eventId}: ${String(error)}`,
      );
      throw error;
    }
  }
}
