import type { AnalyticsService } from '../analytics/analytics.service';
import type { LinksService } from '../links/links.service';

import { ReportGenerationService } from './report-generation.service';
import { computeDailyPeriod, computeWeeklyPeriod } from './utils/report-period';

function makeAnalytics() {
  return {
    getOverview: jest.fn().mockResolvedValue({
      totalClicks: 100,
      humanClicks: 90,
      botClicks: 10,
      uniqueVisitors: 50,
    }),
    getSourceBreakdown: jest.fn().mockResolvedValue([
      { source: 'whatsapp', medium: 'messaging', attributionType: 'campaign', clicks: 40 },
    ]),
    getGeography: jest.fn().mockResolvedValue({
      countries: [{ country: 'NG', clicks: 60 }],
      regions: [],
    }),
    getTopLinks: jest.fn().mockResolvedValue([
      { linkId: 'l1', shortCode: 'abc123', title: 'My link', clicks: 30 },
    ]),
    getTopCampaigns: jest.fn().mockResolvedValue([
      { campaignId: 'c1', name: 'Summer sale', clicks: 40 },
      { campaignId: null, name: 'No campaign', clicks: 60 },
    ]),
    getTimeseries: jest.fn().mockResolvedValue([
      { bucket: new Date('2026-08-20T00:00:00.000Z'), clicks: 10 },
      { bucket: new Date('2026-08-21T00:00:00.000Z'), clicks: 20 },
    ]),
  };
}

function makeLinks() {
  return {
    getWorkspaceStats: jest.fn().mockResolvedValue({
      totalLinks: 12,
      activeLinks: 9,
      pausedLinks: 2,
      expiredLinks: 1,
    }),
  };
}

describe('ReportGenerationService', () => {
  it('queries a custom range matching the given period boundaries, with hourly buckets for a 1-day period', async () => {
    const analytics = makeAnalytics();
    const links = makeLinks();
    const service = new ReportGenerationService(
      analytics as unknown as AnalyticsService,
      links as unknown as LinksService,
    );
    const period = computeDailyPeriod(new Date('2026-08-21T12:00:00.000Z'));

    await service.buildReportData('ws-1', period);

    const expectedQuery = {
      range: 'custom',
      from: period.periodStart.toISOString(),
      to: period.periodEnd.toISOString(),
      timezone: 'UTC',
      includeBots: false,
    };
    expect(analytics.getOverview).toHaveBeenCalledWith('ws-1', expectedQuery);
    expect(analytics.getSourceBreakdown).toHaveBeenCalledWith('ws-1', expectedQuery, 5);
    expect(analytics.getGeography).toHaveBeenCalledWith('ws-1', expectedQuery, 5);
    expect(analytics.getTopLinks).toHaveBeenCalledWith('ws-1', expectedQuery, 5);
    expect(analytics.getTopCampaigns).toHaveBeenCalledWith('ws-1', expectedQuery, 5);
    expect(analytics.getTimeseries).toHaveBeenCalledWith('ws-1', {
      ...expectedQuery,
      interval: 'hour',
    });
    expect(links.getWorkspaceStats).toHaveBeenCalledWith('ws-1');
  });

  it('uses daily buckets for a multi-day (weekly) period', async () => {
    const analytics = makeAnalytics();
    const links = makeLinks();
    const service = new ReportGenerationService(
      analytics as unknown as AnalyticsService,
      links as unknown as LinksService,
    );
    const period = computeWeeklyPeriod(new Date('2026-08-21T12:00:00.000Z'));

    await service.buildReportData('ws-1', period);

    expect(analytics.getTimeseries).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ interval: 'day' }),
    );
  });

  it('maps AnalyticsService/LinksService results into report template variables, excluding the "No campaign" bucket from the count', async () => {
    const analytics = makeAnalytics();
    const links = makeLinks();
    const service = new ReportGenerationService(
      analytics as unknown as AnalyticsService,
      links as unknown as LinksService,
    );
    const period = computeWeeklyPeriod(new Date('2026-08-21T12:00:00.000Z'));

    const data = await service.buildReportData('ws-1', period);

    expect(data.totalClicks).toBe(100);
    expect(data.uniqueVisitors).toBe(50);
    expect(data.activeLinks).toBe(9);
    expect(data.campaignCount).toBe(1); // "No campaign" (campaignId: null) excluded
    expect(data.topSources).toEqual([{ label: 'whatsapp', clicks: 40 }]);
    expect(data.topCountries).toEqual([{ label: 'NG', clicks: 60 }]);
    expect(data.topLinks).toEqual([{ label: 'My link', clicks: 30 }]);
    expect(data.clickTrend).toEqual([
      { label: '2026-08-20', clicks: 10 },
      { label: '2026-08-21', clicks: 20 },
    ]);
    expect(data.reportPeriod).toBe(period.label);
  });

  it('falls back to shortCode when a link has no title', async () => {
    const analytics = makeAnalytics();
    const links = makeLinks();
    analytics.getTopLinks.mockResolvedValue([
      { linkId: 'l1', shortCode: 'abc123', title: null, clicks: 5 },
    ]);
    const service = new ReportGenerationService(
      analytics as unknown as AnalyticsService,
      links as unknown as LinksService,
    );

    const data = await service.buildReportData('ws-1', computeDailyPeriod());

    expect(data.topLinks).toEqual([{ label: 'abc123', clicks: 5 }]);
  });
});
