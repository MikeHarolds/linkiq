import { BadRequestException, Injectable } from '@nestjs/common';

import { AnalyticsCacheService } from '../analytics/analytics-cache.service';
import type {
  AnalyticsQueryDto,
  TimeseriesQueryDto,
} from '../analytics/dto/analytics-query.dto';
import { resolveDateRange } from '../analytics/utils/date-range';
import { PrismaService } from '../prisma/prisma.service';

interface CampaignFilters {
  workspaceId: string;
  campaignId: string;
  from: Date;
  to: Date;
  includeBots: boolean;
}

/**
 * Campaign analytics are entirely derived from the existing ClickEvent
 * table — there is no separate campaign-analytics event or summary
 * table that could drift out of sync with reality. Every query here
 * joins click_events -> links on links."campaignId", the same join
 * shape AnalyticsService.getTopLinks already uses (see that file's
 * comment on why an unqualified "workspaceId" reference is genuinely
 * ambiguous once a JOIN is involved — the same care is taken here).
 * Reuses AnalyticsService's date-range resolution and Redis caching
 * utilities rather than reimplementing either.
 */
@Injectable()
export class CampaignAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AnalyticsCacheService,
  ) {}

  private resolveFilters(
    workspaceId: string,
    campaignId: string,
    query: AnalyticsQueryDto,
  ): CampaignFilters {
    try {
      const { from, to } = resolveDateRange(
        query.range,
        query.timezone,
        query.from,
        query.to,
      );
      return {
        workspaceId,
        campaignId,
        from,
        to,
        includeBots: query.includeBots,
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Invalid date range parameters',
      );
    }
  }

  /** WHERE clause shared by every query below — always joins through
   * `l` (links), always scoped to both workspace and campaign. */
  /**
   * `::uuid` casts below are load-bearing, not decorative — see
   * AnalyticsService.buildWhere's comment for the full explanation.
   * `workspaceId` and `campaignId` are Postgres `uuid` columns; a raw
   * string parameter through `$queryRawUnsafe` is typed `text` by
   * Prisma's query engine unless the SQL says otherwise, which produces
   * `operator does not exist: uuid = text` (SQLSTATE 42883) without the
   * cast.
   */
  private buildWhere(filters: CampaignFilters, startParamIndex: number) {
    const params: unknown[] = [
      filters.workspaceId,
      filters.campaignId,
      filters.from,
      filters.to,
    ];
    let clause = `ce."workspaceId" = $${startParamIndex}::uuid AND l."campaignId" = $${startParamIndex + 1}::uuid AND ce."occurredAt" >= $${startParamIndex + 2} AND ce."occurredAt" < $${startParamIndex + 3}`;
    if (!filters.includeBots) {
      clause += ' AND ce."isBot" = false';
    }
    return { clause, params };
  }

  async getOverview(
    workspaceId: string,
    campaignId: string,
    query: AnalyticsQueryDto,
  ) {
    const cacheKey = { ...query, campaignId };
    const cached = await this.cache.get(
      workspaceId,
      'campaign-overview',
      cacheKey,
    );
    if (cached) return cached;

    const filters = this.resolveFilters(workspaceId, campaignId, query);
    // Overview always breaks out human vs bot regardless of includeBots,
    // matching AnalyticsService.getOverview's own convention.
    const { clause, params } = this.buildWhere(
      { ...filters, includeBots: true },
      1,
    );

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        totalClicks: number;
        humanClicks: number;
        botClicks: number;
        uniqueVisitors: number;
      }>
    >(
      `SELECT
        count(*)::int AS "totalClicks",
        count(*) FILTER (WHERE NOT ce."isBot")::int AS "humanClicks",
        count(*) FILTER (WHERE ce."isBot")::int AS "botClicks",
        count(DISTINCT ce."visitorHash") FILTER (WHERE NOT ce."isBot")::int AS "uniqueVisitors"
      FROM click_events ce
      JOIN links l ON l.id = ce."linkId"
      WHERE ${clause}`,
      ...params,
    );

    const result = rows[0] ?? {
      totalClicks: 0,
      humanClicks: 0,
      botClicks: 0,
      uniqueVisitors: 0,
    };
    await this.cache.set(workspaceId, 'campaign-overview', cacheKey, result);
    return result;
  }

  async getTimeseries(
    workspaceId: string,
    campaignId: string,
    query: TimeseriesQueryDto,
  ) {
    const cacheKey = { ...query, campaignId };
    const cached = await this.cache.get(
      workspaceId,
      'campaign-timeseries',
      cacheKey,
    );
    if (cached) return cached;

    const filters = this.resolveFilters(workspaceId, campaignId, query);
    const { clause, params } = this.buildWhere(filters, 1);
    const truncUnit = query.interval === 'hour' ? 'hour' : 'day';

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ bucket: Date; clicks: number }>
    >(
      `SELECT
        date_trunc('${truncUnit}', ce."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE $${params.length + 1}) AS bucket,
        count(*)::int AS clicks
      FROM click_events ce
      JOIN links l ON l.id = ce."linkId"
      WHERE ${clause}
      GROUP BY bucket
      ORDER BY bucket ASC`,
      ...params,
      query.timezone,
    );

    const result = rows.map((r) => ({ bucket: r.bucket, clicks: r.clicks }));
    await this.cache.set(workspaceId, 'campaign-timeseries', cacheKey, result);
    return result;
  }

  async getTopLinks(
    workspaceId: string,
    campaignId: string,
    query: AnalyticsQueryDto,
    limit = 10,
  ) {
    const cacheKey = { ...query, campaignId, limit };
    const cached = await this.cache.get(
      workspaceId,
      'campaign-top-links',
      cacheKey,
    );
    if (cached) return cached;

    const filters = this.resolveFilters(workspaceId, campaignId, query);
    const { clause, params } = this.buildWhere(filters, 1);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        linkId: string;
        shortCode: string;
        title: string | null;
        clicks: number;
      }>
    >(
      `SELECT ce."linkId" AS "linkId", l."shortCode" AS "shortCode", l.title AS title, count(*)::int AS clicks
      FROM click_events ce
      JOIN links l ON l.id = ce."linkId"
      WHERE ${clause}
      GROUP BY ce."linkId", l."shortCode", l.title
      ORDER BY clicks DESC
      LIMIT ${limit}`,
      ...params,
    );

    await this.cache.set(workspaceId, 'campaign-top-links', cacheKey, rows);
    return rows;
  }

  /** UTM source/medium breakdown — grouped by the LINK's resolved UTM
   * fields (see schema.prisma's comment on Link.utmSource for why these
   * are stored on the link, not derived from ClickEvent.queryParams,
   * which remains reserved for the Sprint 4 QR-attribution mechanism). */
  private async getUtmBreakdown(
    workspaceId: string,
    campaignId: string,
    query: AnalyticsQueryDto,
    column: 'utmSource' | 'utmMedium' | 'utmTerm' | 'utmContent',
    cacheEndpoint: string,
  ) {
    const cacheKey = { ...query, campaignId };
    const cached = await this.cache.get(workspaceId, cacheEndpoint, cacheKey);
    if (cached) return cached;

    const filters = this.resolveFilters(workspaceId, campaignId, query);
    const { clause, params } = this.buildWhere(filters, 1);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ value: string; clicks: number }>
    >(
      `SELECT COALESCE(l."${column}", 'none') AS value, count(*)::int AS clicks
      FROM click_events ce
      JOIN links l ON l.id = ce."linkId"
      WHERE ${clause}
      GROUP BY l."${column}"
      ORDER BY clicks DESC`,
      ...params,
    );

    await this.cache.set(workspaceId, cacheEndpoint, cacheKey, rows);
    return rows;
  }

  getTopSources(
    workspaceId: string,
    campaignId: string,
    query: AnalyticsQueryDto,
  ) {
    return this.getUtmBreakdown(
      workspaceId,
      campaignId,
      query,
      'utmSource',
      'campaign-sources',
    );
  }

  getTopMediums(
    workspaceId: string,
    campaignId: string,
    query: AnalyticsQueryDto,
  ) {
    return this.getUtmBreakdown(
      workspaceId,
      campaignId,
      query,
      'utmMedium',
      'campaign-mediums',
    );
  }

  private async getEventBreakdown(
    workspaceId: string,
    campaignId: string,
    query: AnalyticsQueryDto,
    column: 'country' | 'deviceType' | 'referrerDomain',
    fallback: string,
    cacheEndpoint: string,
  ) {
    const cacheKey = { ...query, campaignId };
    const cached = await this.cache.get(workspaceId, cacheEndpoint, cacheKey);
    if (cached) return cached;

    const filters = this.resolveFilters(workspaceId, campaignId, query);
    const { clause, params } = this.buildWhere(filters, 1);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ value: string; clicks: number }>
    >(
      `SELECT COALESCE(ce."${column}", '${fallback}') AS value, count(*)::int AS clicks
      FROM click_events ce
      JOIN links l ON l.id = ce."linkId"
      WHERE ${clause}
      GROUP BY ce."${column}"
      ORDER BY clicks DESC
      LIMIT 10`,
      ...params,
    );

    await this.cache.set(workspaceId, cacheEndpoint, cacheKey, rows);
    return rows;
  }

  getTopCountries(
    workspaceId: string,
    campaignId: string,
    query: AnalyticsQueryDto,
  ) {
    return this.getEventBreakdown(
      workspaceId,
      campaignId,
      query,
      'country',
      'Unknown',
      'campaign-countries',
    );
  }

  getDeviceBreakdown(
    workspaceId: string,
    campaignId: string,
    query: AnalyticsQueryDto,
  ) {
    return this.getEventBreakdown(
      workspaceId,
      campaignId,
      query,
      'deviceType',
      'unknown',
      'campaign-devices',
    );
  }

  getReferrerBreakdown(
    workspaceId: string,
    campaignId: string,
    query: AnalyticsQueryDto,
  ) {
    return this.getEventBreakdown(
      workspaceId,
      campaignId,
      query,
      'referrerDomain',
      'Direct',
      'campaign-referrers',
    );
  }

  /** Assembles the full response for GET /campaigns/:id/analytics in one
   * call — the controller stays a thin adapter. */
  async getFullAnalytics(
    workspaceId: string,
    campaignId: string,
    query: TimeseriesQueryDto,
  ) {
    const [
      overview,
      clickTrend,
      topLinks,
      topSources,
      topMediums,
      topCountries,
      devices,
      referrers,
    ] = await Promise.all([
      this.getOverview(workspaceId, campaignId, query),
      this.getTimeseries(workspaceId, campaignId, query),
      this.getTopLinks(workspaceId, campaignId, query),
      this.getTopSources(workspaceId, campaignId, query),
      this.getTopMediums(workspaceId, campaignId, query),
      this.getTopCountries(workspaceId, campaignId, query),
      this.getDeviceBreakdown(workspaceId, campaignId, query),
      this.getReferrerBreakdown(workspaceId, campaignId, query),
    ]);

    return {
      overview,
      clickTrend,
      topLinks,
      topSources,
      topMediums,
      topCountries,
      devices,
      referrers,
    };
  }
}
