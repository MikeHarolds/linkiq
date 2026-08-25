import { Injectable } from '@nestjs/common';

import { AnalyticsService } from '../analytics/analytics.service';
import type { AnalyticsQueryDto, TimeseriesQueryDto } from '../analytics/dto/analytics-query.dto';
import type { ReportTemplateVars } from '../email/templates/templates/report.template';
import { LinksService } from '../links/links.service';

import type { ReportPeriod } from './utils/report-period';

// AnalyticsService's methods have no explicit return-type annotations
// (their inferred type widens through AnalyticsCacheService.get<T>'s
// unannotated generic — a pre-existing quirk of that file, not
// something this module touches or needs to fix). These interfaces
// describe the actual shapes those methods produce (confirmed by
// reading analytics.service.ts) so this file can consume them safely
// without modifying analytics.service.ts itself.
interface OverviewResult {
  totalClicks: number;
  humanClicks: number;
  botClicks: number;
  uniqueVisitors: number;
}
interface SourceRow {
  source: string;
  medium: string | null;
  attributionType: string;
  clicks: number;
}
interface GeographyResult {
  countries: Array<{ country: string; clicks: number }>;
  regions: Array<{ region: string; clicks: number }>;
}
interface TopLinkRow {
  linkId: string;
  shortCode: string;
  title: string | null;
  clicks: number;
}
interface TopCampaignRow {
  campaignId: string | null;
  name: string;
  clicks: number;
}
interface TimeseriesPoint {
  bucket: Date;
  clicks: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds report-email template variables by calling AnalyticsService
 * directly and only (§11: "Do not create a second analytics calculation
 * system. Reuse existing analytics services.") — zero new aggregation
 * SQL anywhere in this file. `period` is computed once by the caller
 * (ReportDispatchService, via utils/report-period.ts) so every call
 * below queries the exact same boundaries the EmailReportRun idempotency
 * row was keyed on.
 */
@Injectable()
export class ReportGenerationService {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly links: LinksService,
  ) {}

  async buildReportData(
    workspaceId: string,
    period: ReportPeriod,
  ): Promise<ReportTemplateVars> {
    const query: AnalyticsQueryDto = {
      range: 'custom',
      from: period.periodStart.toISOString(),
      to: period.periodEnd.toISOString(),
      timezone: 'UTC',
      includeBots: false,
    };
    // Hourly buckets for a 1-day period (daily reports), daily buckets
    // for anything longer (weekly reports) — mirrors the dashboard's own
    // interval choice for the same span, see analytics.controller.ts.
    const isSingleDay = period.periodEnd.getTime() - period.periodStart.getTime() <= DAY_MS;
    const timeseriesQuery: TimeseriesQueryDto = {
      ...query,
      interval: isSingleDay ? 'hour' : 'day',
    };

    const [overview, sources, geography, topLinks, campaigns, linkStats, trend] =
      (await Promise.all([
        this.analytics.getOverview(workspaceId, query),
        this.analytics.getSourceBreakdown(workspaceId, query, 5),
        this.analytics.getGeography(workspaceId, query, 5),
        this.analytics.getTopLinks(workspaceId, query, 5),
        this.analytics.getTopCampaigns(workspaceId, query, 5),
        this.links.getWorkspaceStats(workspaceId),
        this.analytics.getTimeseries(workspaceId, timeseriesQuery),
      ])) as [
        OverviewResult,
        SourceRow[],
        GeographyResult,
        TopLinkRow[],
        TopCampaignRow[],
        Awaited<ReturnType<LinksService['getWorkspaceStats']>>,
        TimeseriesPoint[],
      ];

    const appUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    return {
      reportPeriod: period.label,
      totalClicks: overview.totalClicks,
      uniqueVisitors: overview.uniqueVisitors,
      activeLinks: linkStats.activeLinks,
      campaignCount: campaigns.filter((c) => c.campaignId !== null).length,
      topSources: sources.map((s) => ({ label: s.source, clicks: s.clicks })),
      topCountries: geography.countries.map((c) => ({ label: c.country, clicks: c.clicks })),
      topLinks: topLinks.map((l) => ({ label: l.title ?? l.shortCode, clicks: l.clicks })),
      clickTrend: trend.map((t) => ({
        label: isSingleDay
          ? t.bucket.toISOString().slice(11, 16)
          : t.bucket.toISOString().slice(0, 10),
        clicks: t.clicks,
      })),
      dashboardUrl: `${appUrl}/dashboard/analytics`,
    };
  }
}
