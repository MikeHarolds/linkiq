import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module';
import { EmailModule } from '../email/email.module';
import { LinksModule } from '../links/links.module';

import { ReportDispatchProcessor } from './queue/report-dispatch.processor';
import { ReportDispatchScheduler } from './queue/report-dispatch.scheduler';
import { REPORT_DISPATCH_QUEUE } from './queue/report-dispatch.types';
import { ReportDispatchService } from './report-dispatch.service';
import { ReportGenerationService } from './report-generation.service';

/**
 * Daily/weekly analytics report emails (§10-§12 of the Sprint 20 spec).
 * Depends on AnalyticsModule (ReportGenerationService calls
 * AnalyticsService directly, in-process — no HTTP round trip), LinksModule
 * (reuses LinksService.getWorkspaceStats for the "Active links" overview
 * figure rather than a new structural query), and EmailModule
 * (ReportDispatchService queues through EmailService like every other
 * email in the system). Owns its own BullMQ queue plus the scheduler
 * that registers the two recurring ticks on boot.
 */
@Module({
  imports: [
    AnalyticsModule,
    EmailModule,
    LinksModule,
    BullModule.registerQueue({ name: REPORT_DISPATCH_QUEUE }),
  ],
  providers: [
    ReportGenerationService,
    ReportDispatchService,
    ReportDispatchScheduler,
    ReportDispatchProcessor,
  ],
})
export class ReportsModule {}
