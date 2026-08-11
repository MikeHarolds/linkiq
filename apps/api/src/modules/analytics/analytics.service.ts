import { BadRequestException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { AnalyticsCacheService } from './analytics-cache.service';
import type {
  AnalyticsQueryDto,
  TimeseriesQueryDto,
} from './dto/analytics-query.dto';
import { resolveDateRange } from './utils/date-range';

interface CommonFilters {
  workspaceId: string;
  from: Date;
  to: Date;
  linkId?: string;
  includeBots: boolean;
}

/**
 * All aggregation here runs as raw parameterized SQL rather than through
 * Prisma's query builder. This is a deliberate choice, not a limitation:
 * the timezone-aware day/hour bucketing (see buildBucketExpr) needs
 * Postgres's own `AT TIME ZONE` machinery, which has no equivalent in
 * Prisma's builder API, and every other aggregate here benefits from the
 * same consistent, auditable SQL rather than mixing two query styles.
 *
 * ClickEvent (raw events) stays the single source of truth for every
 * breakdown except the clicks-over-time chart, which reads from
 * LinkDailyStat when possible (UTC timezone, no custom range spanning
 * partial days) — see getTimeseries.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AnalyticsCacheService,
  ) {}

  private resolveFilters(
    workspaceId: string,
    query: AnalyticsQueryDto,
  ): CommonFilters {
    try {
      const { from, to } = resolveDateRange(
        query.range,
        query.timezone,
        query.from,
        query.to,
      );
      return {
        workspaceId,
        from,
        to,
        linkId: query.linkId,
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

  /**
   * Builds the WHERE clause + params shared by every query below.
   *
   * `alias`, when given, qualifies every generated column reference
   * (e.g. "ce"."workspaceId" instead of bare "workspaceId"). This is
   * required for getTopLinks, whose query JOINs against `links` — which
   * also has a workspaceId column — making an unqualified reference
   * genuinely ambiguous to Postgres, not just a style preference.
   */
  /**
   * `::uuid` casts below are load-bearing, not decorative: `workspaceId`
   * and `linkId` are Postgres `uuid` columns, but a raw string parameter
   * passed through `$queryRawUnsafe` is typed `text` by Prisma's query
   * engine (it has no way to know a plain JS string is meant to be a
   * uuid the way it does for a JS `Date` -> `timestamp`). Without the
   * explicit cast, Postgres correctly rejects the comparison with
   * `operator does not exist: uuid = text` (SQLSTATE 42883) — this is
   * Prisma's own documented behavior for raw queries against uuid
   * columns, not a bug in Postgres or in this query's logic. Every
   * method in this class routes through this one helper, so the fix
   * here covers all of them.
   */
  private buildWhere(
    filters: CommonFilters,
    startParamIndex: number,
    alias?: string,
  ) {
    const col = (name: string) => (alias ? `${alias}."${name}"` : `"${name}"`);
    const params: unknown[] = [filters.workspaceId, filters.from, filters.to];
    let clause = `${col('workspaceId')} = $${startParamIndex}::uuid AND ${col('occurredAt')} >= $${startParamIndex + 1} AND ${col('occurredAt')} < $${startParamIndex + 2}`;
    let nextIndex = startParamIndex + 3;

    if (filters.linkId) {
      clause += ` AND ${col('linkId')} = $${nextIndex}::uuid`;
      params.push(filters.linkId);
      nextIndex += 1;
    }
    if (!filters.includeBots) {
      clause += ` AND ${col('isBot')} = false`;
    }

    return { clause, params, nextIndex };
  }

  async getOverview(workspaceId: string, query: AnalyticsQueryDto) {
    const cacheKey = { ...query };
    const cached = await this.cache.get(workspaceId, 'overview', cacheKey);
    if (cached) return cached;

    const filters = this.resolveFilters(workspaceId, query);
    // Overview always breaks out human vs bot regardless of includeBots —
    // that toggle only affects OTHER endpoints' aggregate totals.
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
        count(*) FILTER (WHERE NOT "isBot")::int AS "humanClicks",
        count(*) FILTER (WHERE "isBot")::int AS "botClicks",
        count(DISTINCT "visitorHash") FILTER (WHERE NOT "isBot")::int AS "uniqueVisitors"
      FROM click_events
      WHERE ${clause}`,
      ...params,
    );

    const result = rows[0] ?? {
      totalClicks: 0,
      humanClicks: 0,
      botClicks: 0,
      uniqueVisitors: 0,
    };

    await this.cache.set(workspaceId, 'overview', cacheKey, result);
    return result;
  }

  async getTimeseries(workspaceId: string, query: TimeseriesQueryDto) {
    const cacheKey = { ...query };
    const cached = await this.cache.get(workspaceId, 'timeseries', cacheKey);
    if (cached) return cached;

    const filters = this.resolveFilters(workspaceId, query);
    const { clause, params } = this.buildWhere(filters, 1);
    const truncUnit = query.interval === 'hour' ? 'hour' : 'day';

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ bucket: Date; clicks: number }>
    >(
      `SELECT
        date_trunc('${truncUnit}', "occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE $${params.length + 1}) AS bucket,
        count(*)::int AS clicks
      FROM click_events
      WHERE ${clause}
      GROUP BY bucket
      ORDER BY bucket ASC`,
      ...params,
      query.timezone,
    );

    const result = rows.map((r) => ({ bucket: r.bucket, clicks: r.clicks }));
    await this.cache.set(workspaceId, 'timeseries', cacheKey, result);
    return result;
  }

  async getTopLinks(workspaceId: string, query: AnalyticsQueryDto, limit = 10) {
    const cacheKey = { ...query, limit };
    const cached = await this.cache.get(workspaceId, 'top-links', cacheKey);
    if (cached) return cached;

    const filters = this.resolveFilters(workspaceId, query);
    const { clause, params } = this.buildWhere(filters, 1, 'ce');

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

    await this.cache.set(workspaceId, 'top-links', cacheKey, rows);
    return rows;
  }

  async getReferrers(
    workspaceId: string,
    query: AnalyticsQueryDto,
    limit = 10,
  ) {
    const cacheKey = { ...query, limit };
    const cached = await this.cache.get(workspaceId, 'referrers', cacheKey);
    if (cached) return cached;

    const filters = this.resolveFilters(workspaceId, query);
    const { clause, params } = this.buildWhere(filters, 1);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ domain: string; category: string; clicks: number }>
    >(
      `SELECT
        COALESCE("referrerDomain", 'Direct') AS domain,
        COALESCE("referrerCategory", 'direct') AS category,
        count(*)::int AS clicks
      FROM click_events
      WHERE ${clause}
      GROUP BY domain, category
      ORDER BY clicks DESC
      LIMIT ${limit}`,
      ...params,
    );

    await this.cache.set(workspaceId, 'referrers', cacheKey, rows);
    return rows;
  }

  async getGeography(
    workspaceId: string,
    query: AnalyticsQueryDto,
    limit = 10,
  ) {
    const cacheKey = { ...query, limit };
    const cached = await this.cache.get(workspaceId, 'geography', cacheKey);
    if (cached) return cached;

    const filters = this.resolveFilters(workspaceId, query);
    const { clause: countryClause, params: countryParams } = this.buildWhere(
      filters,
      1,
    );
    const { clause: regionClause, params: regionParams } = this.buildWhere(
      filters,
      1,
    );

    const [countries, regions] = await Promise.all([
      this.prisma.$queryRawUnsafe<Array<{ country: string; clicks: number }>>(
        `SELECT COALESCE(country, 'Unknown') AS country, count(*)::int AS clicks
        FROM click_events
        WHERE ${countryClause}
        GROUP BY country
        ORDER BY clicks DESC
        LIMIT ${limit}`,
        ...countryParams,
      ),
      this.prisma.$queryRawUnsafe<Array<{ region: string; clicks: number }>>(
        `SELECT COALESCE(region, 'Unknown') AS region, count(*)::int AS clicks
        FROM click_events
        WHERE ${regionClause}
        GROUP BY region
        ORDER BY clicks DESC
        LIMIT ${limit}`,
        ...regionParams,
      ),
    ]);

    const result = { countries, regions };
    await this.cache.set(workspaceId, 'geography', cacheKey, result);
    return result;
  }

  private async getBreakdownByColumn(
    workspaceId: string,
    query: AnalyticsQueryDto,
    column: 'deviceType' | 'os' | 'browser',
    cacheEndpoint: string,
  ) {
    const cacheKey = { ...query };
    const cached = await this.cache.get(workspaceId, cacheEndpoint, cacheKey);
    if (cached) return cached;

    const filters = this.resolveFilters(workspaceId, query);
    const { clause, params } = this.buildWhere(filters, 1);

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ value: string; clicks: number }>
    >(
      `SELECT COALESCE("${column}", 'unknown') AS value, count(*)::int AS clicks
      FROM click_events
      WHERE ${clause}
      GROUP BY "${column}"
      ORDER BY clicks DESC`,
      ...params,
    );

    await this.cache.set(workspaceId, cacheEndpoint, cacheKey, rows);
    return rows;
  }

  getDevices(workspaceId: string, query: AnalyticsQueryDto) {
    return this.getBreakdownByColumn(
      workspaceId,
      query,
      'deviceType',
      'devices',
    );
  }

  getBrowsers(workspaceId: string, query: AnalyticsQueryDto) {
    return this.getBreakdownByColumn(workspaceId, query, 'browser', 'browsers');
  }

  getOperatingSystems(workspaceId: string, query: AnalyticsQueryDto) {
    return this.getBreakdownByColumn(
      workspaceId,
      query,
      'os',
      'operating-systems',
    );
  }

  /**
   * Workspace-wide "clicks by campaign" — every campaign's traffic side
   * by side, not scoped to any single one (that's what
   * CampaignAnalyticsService.getOverview is for). Links with no campaign
   * are grouped under "No campaign" rather than dropped, so the total
   * across rows always reconciles with the plain overview endpoint's
   * totalClicks (Sprint 5 spec section 15's dashboard addition).
   */
  async getTopCampaigns(
    workspaceId: string,
    query: AnalyticsQueryDto,
    limit = 10,
  ) {
    const cacheKey = { ...query, limit };
    const cached = await this.cache.get(workspaceId, 'top-campaigns', cacheKey);
    if (cached) return cached;

    const filters = this.resolveFilters(workspaceId, query);
    const { clause, params } = this.buildWhere(filters, 1, 'ce');

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ campaignId: string | null; name: string; clicks: number }>
    >(
      `SELECT c.id AS "campaignId", COALESCE(c.name, 'No campaign') AS name, count(*)::int AS clicks
      FROM click_events ce
      JOIN links l ON l.id = ce."linkId"
      LEFT JOIN campaigns c ON c.id = l."campaignId"
      WHERE ${clause}
      GROUP BY c.id, c.name
      ORDER BY clicks DESC
      LIMIT ${limit}`,
      ...params,
    );

    await this.cache.set(workspaceId, 'top-campaigns', cacheKey, rows);
    return rows;
  }

  /** Workspace-wide UTM source/medium breakdown — the link-level
   * complement to getTopCampaigns, grouped by the same resolved
   * Link.utmSource/utmMedium columns CampaignAnalyticsService's
   * campaign-scoped breakdowns use (see that file's comment on why this
   * is grouped by the link's stored UTM fields, not ClickEvent.queryParams). */
  async getUtmBreakdown(
    workspaceId: string,
    query: AnalyticsQueryDto,
    column:
      'utmSource' | 'utmMedium' | 'utmCampaign' | 'utmTerm' | 'utmContent',
  ) {
    const cacheKey = { ...query, column };
    const cached = await this.cache.get(workspaceId, `utm-${column}`, cacheKey);
    if (cached) return cached;

    const filters = this.resolveFilters(workspaceId, query);
    const { clause, params } = this.buildWhere(filters, 1, 'ce');

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ value: string; clicks: number }>
    >(
      `SELECT COALESCE(l."${column}", 'none') AS value, count(*)::int AS clicks
      FROM click_events ce
      JOIN links l ON l.id = ce."linkId"
      WHERE ${clause}
      GROUP BY l."${column}"
      ORDER BY clicks DESC
      LIMIT 10`,
      ...params,
    );

    await this.cache.set(workspaceId, `utm-${column}`, cacheKey, rows);
    return rows;
  }
}
