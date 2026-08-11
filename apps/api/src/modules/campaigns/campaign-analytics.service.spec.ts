import { CampaignAnalyticsService } from './campaign-analytics.service';

const WORKSPACE_ID = 'ws-1';
const CAMPAIGN_ID = 'campaign-1';

function baseQuery() {
  return { range: '7d' as const, timezone: 'UTC', includeBots: false };
}

describe('CampaignAnalyticsService', () => {
  let prisma: { $queryRawUnsafe: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: CampaignAnalyticsService;

  beforeEach(() => {
    prisma = { $queryRawUnsafe: jest.fn() };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    service = new CampaignAnalyticsService(
      prisma as unknown as never,
      cache as unknown as never,
    );
  });

  describe('caching', () => {
    it('includes campaignId in the cache key params (cache isolation between campaigns)', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getOverview(WORKSPACE_ID, CAMPAIGN_ID, baseQuery());

      expect(cache.get).toHaveBeenCalledWith(
        WORKSPACE_ID,
        'campaign-overview',
        expect.objectContaining({ campaignId: CAMPAIGN_ID }),
      );
    });

    it('returns the cached value without querying on a hit', async () => {
      cache.get.mockResolvedValue({
        totalClicks: 5,
        humanClicks: 5,
        botClicks: 0,
        uniqueVisitors: 3,
      });

      const result = await service.getOverview(
        WORKSPACE_ID,
        CAMPAIGN_ID,
        baseQuery(),
      );

      expect(result).toEqual({
        totalClicks: 5,
        humanClicks: 5,
        botClicks: 0,
        uniqueVisitors: 3,
      });
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('uses distinct cache entries for different campaigns in the same workspace', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getOverview(WORKSPACE_ID, 'campaign-A', baseQuery());
      await service.getOverview(WORKSPACE_ID, 'campaign-B', baseQuery());

      const [, , keyA] = cache.get.mock.calls[0];
      const [, , keyB] = cache.get.mock.calls[1];
      expect(keyA.campaignId).not.toBe(keyB.campaignId);
    });
  });

  describe('query construction', () => {
    it('getOverview joins links and filters by both workspaceId and campaignId', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getOverview(WORKSPACE_ID, CAMPAIGN_ID, baseQuery());

      const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('JOIN links l ON l.id = ce."linkId"');
      expect(sql).toContain('l."campaignId"');
      expect(params[0]).toBe(WORKSPACE_ID);
      expect(params[1]).toBe(CAMPAIGN_ID);
    });

    it('getOverview always breaks out bots regardless of includeBots', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getOverview(WORKSPACE_ID, CAMPAIGN_ID, baseQuery());

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).not.toContain('ce."isBot" = false');
    });

    it('getTopLinks excludes bots by default', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getTopLinks(WORKSPACE_ID, CAMPAIGN_ID, baseQuery());

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('ce."isBot" = false');
    });

    it('getTopLinks includes bots when includeBots=true', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getTopLinks(WORKSPACE_ID, CAMPAIGN_ID, {
        ...baseQuery(),
        includeBots: true,
      });

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).not.toContain('ce."isBot" = false');
    });

    it('getTopSources groups by the LINK utmSource column, not ClickEvent.queryParams', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getTopSources(WORKSPACE_ID, CAMPAIGN_ID, baseQuery());

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('l."utmSource"');
      expect(sql).not.toContain('queryParams');
    });

    it('getTopMediums groups by the LINK utmMedium column', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getTopMediums(WORKSPACE_ID, CAMPAIGN_ID, baseQuery());

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('l."utmMedium"');
    });

    it('getTopCountries groups by ClickEvent.country with an Unknown fallback', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getTopCountries(WORKSPACE_ID, CAMPAIGN_ID, baseQuery());

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('ce."country"');
      expect(sql).toContain("'Unknown'");
    });

    it('getDeviceBreakdown groups by ClickEvent.deviceType', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getDeviceBreakdown(WORKSPACE_ID, CAMPAIGN_ID, baseQuery());

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('ce."deviceType"');
    });

    it('getReferrerBreakdown groups by ClickEvent.referrerDomain with a Direct fallback', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getReferrerBreakdown(
        WORKSPACE_ID,
        CAMPAIGN_ID,
        baseQuery(),
      );

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('ce."referrerDomain"');
      expect(sql).toContain("'Direct'");
    });

    it('getTimeseries applies timezone-aware bucketing', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getTimeseries(WORKSPACE_ID, CAMPAIGN_ID, {
        ...baseQuery(),
        interval: 'day' as const,
      });

      const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain("date_trunc('day'");
      expect(sql).toContain('AT TIME ZONE');
      expect(params).toContain('UTC');
    });
  });

  describe('getFullAnalytics', () => {
    it('assembles overview, trend, and every breakdown in one response', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      const result = await service.getFullAnalytics(WORKSPACE_ID, CAMPAIGN_ID, {
        ...baseQuery(),
        interval: 'day' as const,
      });

      expect(result).toHaveProperty('overview');
      expect(result).toHaveProperty('clickTrend');
      expect(result).toHaveProperty('topLinks');
      expect(result).toHaveProperty('topSources');
      expect(result).toHaveProperty('topMediums');
      expect(result).toHaveProperty('topCountries');
      expect(result).toHaveProperty('devices');
      expect(result).toHaveProperty('referrers');
    });
  });

  /**
   * Regression suite: the same class of bug fixed in
   * AnalyticsService.buildWhere (see that file's spec for the full
   * writeup and a real-Postgres reproduction of the exact SQLSTATE
   * 42883 error) also existed in this class's own buildWhere — a
   * separate implementation, not shared code, so it needed its own fix
   * and its own regression coverage.
   */
  describe('UUID parameter casting (regression)', () => {
    const METHODS: Array<{ name: string; run: () => Promise<unknown> }> = [];

    beforeEach(() => {
      METHODS.push(
        {
          name: 'getOverview',
          run: () =>
            service.getOverview(WORKSPACE_ID, CAMPAIGN_ID, baseQuery()),
        },
        {
          name: 'getTimeseries',
          run: () =>
            service.getTimeseries(WORKSPACE_ID, CAMPAIGN_ID, {
              ...baseQuery(),
              interval: 'day' as const,
            }),
        },
        {
          name: 'getTopLinks',
          run: () =>
            service.getTopLinks(WORKSPACE_ID, CAMPAIGN_ID, baseQuery()),
        },
        {
          name: 'getTopSources',
          run: () =>
            service.getTopSources(WORKSPACE_ID, CAMPAIGN_ID, baseQuery()),
        },
        {
          name: 'getTopMediums',
          run: () =>
            service.getTopMediums(WORKSPACE_ID, CAMPAIGN_ID, baseQuery()),
        },
        {
          name: 'getTopCountries',
          run: () =>
            service.getTopCountries(WORKSPACE_ID, CAMPAIGN_ID, baseQuery()),
        },
        {
          name: 'getDeviceBreakdown',
          run: () =>
            service.getDeviceBreakdown(WORKSPACE_ID, CAMPAIGN_ID, baseQuery()),
        },
        {
          name: 'getReferrerBreakdown',
          run: () =>
            service.getReferrerBreakdown(
              WORKSPACE_ID,
              CAMPAIGN_ID,
              baseQuery(),
            ),
        },
      );
    });

    afterEach(() => {
      METHODS.length = 0;
    });

    it('casts both workspaceId and campaignId to ::uuid in every campaign-analytics query', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      for (const { name, run } of METHODS) {
        prisma.$queryRawUnsafe.mockClear();
        // eslint-disable-next-line no-await-in-loop
        await run();

        const calls = prisma.$queryRawUnsafe.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        for (const [sql] of calls) {
          if (!/ce\."workspaceId"\s*=\s*\$\d+::uuid/.test(sql)) {
            throw new Error(
              `${name}'s SQL must cast ce.workspaceId to ::uuid — got:\n${sql}`,
            );
          }
          if (!/l\."campaignId"\s*=\s*\$\d+::uuid/.test(sql)) {
            throw new Error(
              `${name}'s SQL must cast l.campaignId to ::uuid — got:\n${sql}`,
            );
          }
        }
      }
    });
  });
});
