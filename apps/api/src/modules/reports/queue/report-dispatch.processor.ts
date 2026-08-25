import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';

import { ReportDispatchService } from '../report-dispatch.service';

import { REPORT_DISPATCH_QUEUE, type ReportDispatchJobData } from './report-dispatch.types';

/** Consumes the hourly daily/weekly ticks and hands off to
 * ReportDispatchService.runTick — the actual eligibility/idempotency/
 * dispatch logic lives there, this is purely the BullMQ adapter. */
@Processor(REPORT_DISPATCH_QUEUE)
@Injectable()
export class ReportDispatchProcessor extends WorkerHost {
  constructor(private readonly dispatch: ReportDispatchService) {
    super();
  }

  async process(job: Job<ReportDispatchJobData>): Promise<void> {
    await this.dispatch.runTick(job.data.frequency);
  }
}
