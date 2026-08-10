import { Module } from '@nestjs/common';

import { AnalyticsModule } from '../analytics/analytics.module';

import { CampaignAnalyticsService } from './campaign-analytics.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

/**
 * Campaign Management & UTM Tracking (Sprint 5).
 *
 * A campaign is purely an organizational/analytics grouping over
 * existing Links — it has no redirect or tracking mechanism of its own.
 * Campaign analytics (CampaignAnalyticsService) query the EXISTING
 * ClickEvent table with an added JOIN to links.campaignId; there is no
 * second analytics pipeline. AnalyticsCacheService is imported from
 * AnalyticsModule and reused directly (not reimplemented) — its cache
 * keys already include every param passed to it, and campaignId is
 * always part of that params object here, so campaign-scoped cache
 * isolation falls out of the existing mechanism for free.
 */
@Module({
  imports: [AnalyticsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignAnalyticsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
