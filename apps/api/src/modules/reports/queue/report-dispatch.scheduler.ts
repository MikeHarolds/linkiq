import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';

import {
  DAILY_REPORT_SCHEDULER_ID,
  REPORT_DISPATCH_QUEUE,
  RUN_DAILY_TICK_JOB,
  RUN_WEEKLY_TICK_JOB,
  WEEKLY_REPORT_SCHEDULER_ID,
  type ReportDispatchJobData,
} from './report-dispatch.types';

/**
 * Registers the two recurring report-dispatch jobs on every app boot,
 * using BullMQ's own native repeatable-job engine (`upsertJobScheduler`)
 * rather than a new dependency like `@nestjs/schedule` — no cron/
 * scheduling infrastructure of any kind existed anywhere in this
 * codebase before this sprint (confirmed via exhaustive search), and
 * bullmq/@nestjs/bullmq are already installed and wired via
 * QueueModule, matching this codebase's existing "reuse BullMQ's
 * engine, don't hand-roll a scheduler" philosophy (see
 * WebhookDeliveryProducer's own docs).
 *
 * `upsertJobScheduler` is itself idempotent by scheduler id — calling
 * it again on every restart just confirms the same schedule, it never
 * creates a duplicate. Firing hourly (rather than at one fixed minute)
 * lets ReportDispatchService.runTick decide, per tick, exactly which
 * users are due this UTC hour (+ day, for weekly) — see that service's
 * own docs — without needing a distinct BullMQ schedule per user.
 */
@Injectable()
export class ReportDispatchScheduler implements OnModuleInit {
  private readonly logger = new Logger(ReportDispatchScheduler.name);

  constructor(
    @InjectQueue(REPORT_DISPATCH_QUEUE)
    private readonly queue: Queue<ReportDispatchJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    // A registered BullMQ repeatable job holds a real timer open until its
    // next scheduled run (up to an hour away for this pattern) — harmless
    // in a long-running server process, but it leaves the event loop
    // non-empty for the lifetime of any short-lived process that boots
    // this module, including every e2e test run (which boots the full
    // AppModule via Nest's TestingModule). Skipping registration in the
    // test environment avoids that dangling-timer/open-handle problem
    // without touching production/dev behavior at all.
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    await this.queue.upsertJobScheduler(
      DAILY_REPORT_SCHEDULER_ID,
      { pattern: '0 * * * *' },
      { name: RUN_DAILY_TICK_JOB, data: { frequency: 'DAILY' } },
    );
    await this.queue.upsertJobScheduler(
      WEEKLY_REPORT_SCHEDULER_ID,
      { pattern: '0 * * * *' },
      { name: RUN_WEEKLY_TICK_JOB, data: { frequency: 'WEEKLY' } },
    );
    this.logger.log('Registered daily/weekly report-dispatch schedulers');
  }
}
