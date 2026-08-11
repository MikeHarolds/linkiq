import { BadRequestException } from '@nestjs/common';

import { AnalyticsService } from './analytics.service';
import type {
  AnalyticsQueryDto,
  TimeseriesQueryDto,
} from './dto/analytics-query.dto';

function baseQuery(
  overrides: Partial<AnalyticsQueryDto> = {},
): AnalyticsQueryDto {
  return { range: '7d', timezone: 'UTC', includeBots: false, ...overrides };
}

describe('AnalyticsService', () => {
  let prisma: { $queryRawUnsafe: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock };
  let service: AnalyticsService;

  beforeEach(() => {
    prisma = { $queryRawUnsafe: jest.fn() };
    cache = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };
    service = new AnalyticsService(
      prisma as unknown as never,
      cache as unknown as never,
    );
  });

  describe('caching', () => {
    it('returns the cached value without querying the database on a cache hit', async () => {
      cache.get.mockResolvedValue({
        totalClicks: 42,
        humanClicks: 40,
        botClicks: 2,
        uniqueVisitors: 10,
      });

      const result = await service.getOverview('ws-1', baseQuery());

      expect(result).toEqual({
        totalClicks: 42,
        humanClicks: 40,
        botClicks: 2,
        uniqueVisitors: 10,
      });
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('queries the database and populates the cache on a miss', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([
        { totalClicks: 5, humanClicks: 4, botClicks: 1, uniqueVisitors: 3 },
      ]);

      await service.getOverview('ws-1', baseQuery());

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
      expect(cache.set).toHaveBeenCalledWith(
        'ws-1',
        'overview',
        expect.objectContaining({ range: '7d' }),
        expect.objectContaining({ totalClicks: 5 }),
      );
    });

    it('uses distinct cache keys for different workspaces (isolation)', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([
        { totalClicks: 1, humanClicks: 1, botClicks: 0, uniqueVisitors: 1 },
      ]);

      await service.getOverview('ws-A', baseQuery());
      await service.getOverview('ws-B', baseQuery());

      expect(cache.get).toHaveBeenNthCalledWith(
        1,
        'ws-A',
        'overview',
        expect.anything(),
      );
      expect(cache.get).toHaveBeenNthCalledWith(
        2,
        'ws-B',
        'overview',
        expect.anything(),
      );
    });
  });

  describe('getOverview', () => {
    it('returns zeroed metrics when there are no events', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      const result = await service.getOverview('ws-1', baseQuery());
      expect(result).toEqual({
        totalClicks: 0,
        humanClicks: 0,
        botClicks: 0,
        uniqueVisitors: 0,
      });
    });

    it('always includes bots in the underlying query regardless of includeBots (overview always breaks out both)', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([
        { totalClicks: 10, humanClicks: 8, botClicks: 2, uniqueVisitors: 5 },
      ]);

      await service.getOverview('ws-1', baseQuery({ includeBots: false }));

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).not.toContain('"isBot" = false');
    });

    it('scopes the query to the requested workspace', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      await service.getOverview('ws-specific', baseQuery());

      const [, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(params[0]).toBe('ws-specific');
    });

    it('applies a linkId filter when provided', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      await service.getOverview(
        'ws-1',
        baseQuery({ linkId: '11111111-1111-1111-1111-111111111111' }),
      );

      const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('"linkId" =');
      expect(params).toContain('11111111-1111-1111-1111-111111111111');
    });

    it('throws BadRequestException for an invalid custom range', async () => {
      await expect(
        service.getOverview('ws-1', baseQuery({ range: 'custom' })),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getTimeseries', () => {
    it('excludes bots by default', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      const query: TimeseriesQueryDto = { ...baseQuery(), interval: 'day' };

      await service.getTimeseries('ws-1', query);

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('"isBot" = false');
    });

    it('includes bots when includeBots=true', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      const query: TimeseriesQueryDto = {
        ...baseQuery({ includeBots: true }),
        interval: 'day',
      };

      await service.getTimeseries('ws-1', query);

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).not.toContain('"isBot" = false');
    });

    it('buckets by hour when interval=hour', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      const query: TimeseriesQueryDto = { ...baseQuery(), interval: 'hour' };

      await service.getTimeseries('ws-1', query);

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain("date_trunc('hour'");
    });

    it('buckets by day when interval=day', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      const query: TimeseriesQueryDto = { ...baseQuery(), interval: 'day' };

      await service.getTimeseries('ws-1', query);

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain("date_trunc('day'");
    });

    it('passes the requested timezone through to the query', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      const query: TimeseriesQueryDto = {
        ...baseQuery({ timezone: 'America/New_York' }),
        interval: 'day',
      };

      await service.getTimeseries('ws-1', query);

      const [, ...params] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(params).toContain('America/New_York');
    });
  });

  describe('getGeography', () => {
    it('returns both countries and regions', async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ country: 'US', clicks: 5 }])
        .mockResolvedValueOnce([{ region: 'Unknown', clicks: 5 }]);

      const result = await service.getGeography('ws-1', baseQuery());

      expect(result).toEqual({
        countries: [{ country: 'US', clicks: 5 }],
        regions: [{ region: 'Unknown', clicks: 5 }],
      });
    });
  });

  describe('device/browser/OS breakdowns', () => {
    it('getDevices groups by deviceType', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([
        { value: 'mobile', clicks: 3 },
      ]);
      await service.getDevices('ws-1', baseQuery());
      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('"deviceType"');
    });

    it('getBrowsers groups by browser', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([
        { value: 'Chrome', clicks: 3 },
      ]);
      await service.getBrowsers('ws-1', baseQuery());
      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('"browser"');
    });

    it('getOperatingSystems groups by os', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ value: 'iOS', clicks: 3 }]);
      await service.getOperatingSystems('ws-1', baseQuery());
      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('"os"');
    });

    it('uses separate cache namespaces for devices/browsers/os', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      await service.getDevices('ws-1', baseQuery());
      await service.getBrowsers('ws-1', baseQuery());
      await service.getOperatingSystems('ws-1', baseQuery());

      expect(cache.get).toHaveBeenNthCalledWith(
        1,
        'ws-1',
        'devices',
        expect.anything(),
      );
      expect(cache.get).toHaveBeenNthCalledWith(
        2,
        'ws-1',
        'browsers',
        expect.anything(),
      );
      expect(cache.get).toHaveBeenNthCalledWith(
        3,
        'ws-1',
        'operating-systems',
        expect.anything(),
      );
    });
  });

  describe('getTopLinks', () => {
    it('joins against links and orders by click count descending', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([
        { linkId: 'link-1', shortCode: 'abc', title: 'Test', clicks: 10 },
      ]);

      const result = await service.getTopLinks('ws-1', baseQuery());

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('JOIN links');
      expect(sql).toContain('ORDER BY clicks DESC');
      expect(result).toHaveLength(1);
    });

    // Regression test: click_events and links both have a workspaceId
    // column, so an unqualified "workspaceId" reference in a query that
    // JOINs both tables is genuinely ambiguous to Postgres, not just a
    // style nit — this was a real bug caught by live-server testing
    // against seeded demo data, not by any mocked unit test (mocking
    // $queryRawUnsafe entirely hides SQL-validity bugs like this one).
    it('qualifies every WHERE-clause column with the ce. table alias (avoids ambiguous column errors)', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getTopLinks(
        'ws-1',
        baseQuery({ linkId: '11111111-1111-1111-1111-111111111111' }),
      );

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toMatch(/ce\."workspaceId"\s*=/);
      expect(sql).toMatch(/ce\."occurredAt"\s*>=/);
      expect(sql).toMatch(/ce\."linkId"\s*=/);
      // No bare, unqualified reference to any of these ambiguous columns.
      expect(sql).not.toMatch(/[^.]"workspaceId"/);
    });
  });

  describe('getReferrers', () => {
    it('falls back to "Direct" for null referrerDomain', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([
        { domain: 'Direct', category: 'direct', clicks: 7 },
      ]);

      const result = await service.getReferrers('ws-1', baseQuery());

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('COALESCE("referrerDomain", \'Direct\')');
      expect(result).toEqual([
        { domain: 'Direct', category: 'direct', clicks: 7 },
      ]);
    });
  });

  describe('getTopCampaigns (Sprint 5)', () => {
    it('joins links and campaigns, grouping links with no campaign under "No campaign"', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([
        { campaignId: 'c-1', name: 'Summer', clicks: 10 },
        { campaignId: null, name: 'No campaign', clicks: 5 },
      ]);

      const result = await service.getTopCampaigns('ws-1', baseQuery());

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('LEFT JOIN campaigns');
      expect(sql).toContain("'No campaign'");
      expect(result).toHaveLength(2);
    });

    it('qualifies WHERE-clause columns to avoid ambiguity across the three joined tables', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getTopCampaigns('ws-1', baseQuery());

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toMatch(/ce\."workspaceId"\s*=/);
    });
  });

  describe('getUtmBreakdown (Sprint 5)', () => {
    it('groups by the requested link UTM column', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([
        { value: 'facebook', clicks: 3 },
      ]);

      await service.getUtmBreakdown('ws-1', baseQuery(), 'utmSource');

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toContain('l."utmSource"');
    });

    it('uses a distinct cache namespace per UTM field', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getUtmBreakdown('ws-1', baseQuery(), 'utmSource');
      await service.getUtmBreakdown('ws-1', baseQuery(), 'utmMedium');

      expect(cache.get).toHaveBeenNthCalledWith(
        1,
        'ws-1',
        'utm-utmSource',
        expect.anything(),
      );
      expect(cache.get).toHaveBeenNthCalledWith(
        2,
        'ws-1',
        'utm-utmMedium',
        expect.anything(),
      );
    });
  });

  /**
   * Regression suite for a real production bug: every raw-SQL query here
   * compares a bare string parameter against Postgres `uuid` columns
   * (`workspaceId`, `linkId`). Against the actual generated Prisma
   * Client, `$queryRawUnsafe` types a plain JS string parameter as
   * `text`, not `uuid` — Postgres then rejects the comparison with
   * `operator does not exist: uuid = text` (SQLSTATE 42883), since it
   * has no such operator and (unlike a bare unqualified parameter in a
   * context Postgres itself controls) does not attempt to coerce an
   * explicitly-`text`-typed value into `uuid`. This was reproduced
   * directly against a real Postgres connection during development:
   *
   *   SELECT count(*) FROM click_events WHERE "workspaceId" = ($1::text)
   *   -- forcing $1 to bind as text, exactly mirroring what Prisma's
   *   -- query engine does for a bare string parameter -- fails with
   *   -- the exact reported error: "operator does not exist: uuid =
   *   -- text", 42883.
   *
   * These tests assert the fix (`::uuid` on every workspaceId/linkId
   * comparison) is present in the generated SQL for every affected
   * method — the local test double's Postgres driver (unlike the real
   * Prisma Client) infers parameter types from context regardless, so
   * it does not itself surface this bug; asserting on the SQL text is
   * what actually guards against the cast being silently dropped again.
   */
  describe('UUID parameter casting (regression)', () => {
    const UUID_CAST_METHODS: Array<{
      name: string;
      run: () => Promise<unknown>;
    }> = [];

    beforeEach(() => {
      UUID_CAST_METHODS.push(
        {
          name: 'getOverview',
          run: () => service.getOverview('ws-1', baseQuery()),
        },
        {
          name: 'getTimeseries',
          run: () =>
            service.getTimeseries('ws-1', { ...baseQuery(), interval: 'day' }),
        },
        {
          name: 'getTopLinks',
          run: () => service.getTopLinks('ws-1', baseQuery()),
        },
        {
          name: 'getReferrers',
          run: () => service.getReferrers('ws-1', baseQuery()),
        },
        {
          name: 'getGeography',
          run: () => service.getGeography('ws-1', baseQuery()),
        },
        {
          name: 'getDevices',
          run: () => service.getDevices('ws-1', baseQuery()),
        },
        {
          name: 'getBrowsers',
          run: () => service.getBrowsers('ws-1', baseQuery()),
        },
        {
          name: 'getOperatingSystems',
          run: () => service.getOperatingSystems('ws-1', baseQuery()),
        },
        {
          name: 'getTopCampaigns',
          run: () => service.getTopCampaigns('ws-1', baseQuery()),
        },
        {
          name: 'getUtmBreakdown',
          run: () => service.getUtmBreakdown('ws-1', baseQuery(), 'utmSource'),
        },
      );
    });

    afterEach(() => {
      UUID_CAST_METHODS.length = 0;
    });

    it('casts the workspaceId parameter to ::uuid in every analytics query', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      for (const { name, run } of UUID_CAST_METHODS) {
        prisma.$queryRawUnsafe.mockClear();
        // eslint-disable-next-line no-await-in-loop
        await run();

        const calls = prisma.$queryRawUnsafe.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        for (const [sql] of calls) {
          if (!/"workspaceId"\s*=\s*\$\d+::uuid/.test(sql)) {
            throw new Error(
              `${name}'s SQL must cast workspaceId to ::uuid — got:\n${sql}`,
            );
          }
        }
      }
    });

    it('casts the linkId parameter to ::uuid when a link filter is applied', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.getOverview('ws-1', { ...baseQuery(), linkId: 'link-1' });

      const [sql] = prisma.$queryRawUnsafe.mock.calls[0];
      expect(sql).toMatch(/"linkId"\s*=\s*\$\d+::uuid/);
    });
  });
});
