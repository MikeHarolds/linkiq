import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ApiUsageOverview {
  totalRequests: number;
  failedRequests: number;
  activeApiKeys: number;
  requestsOverTime: Array<{ date: string; count: number }>;
  topWorkspaces: Array<{
    workspaceId: string;
    workspaceName: string;
    requests: number;
  }>;
}

/**
 * Platform-wide API usage metrics (Sprint 11 — Super Admin). Sprint 8's
 * `ApiUsageEvent` table already records every request (endpoint, method,
 * statusCode, durationMs, workspaceId, apiKeyId) — this is a new read
 * path over that existing data, not a new counter. No aggregate
 * cross-workspace query existed before this (BillingUsageService's own
 * usage of this table is a single-workspace, current-billing-period
 * count only — see its docs).
 */
@Injectable()
export class AdminApiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(from: Date, to: Date): Promise<ApiUsageOverview> {
    const dateWhere: Prisma.ApiUsageEventWhereInput = {
      createdAt: { gte: from, lte: to },
    };

    const [
      totalRequests,
      failedRequests,
      activeApiKeys,
      topWorkspacesRaw,
      dailyRows,
    ] = await Promise.all([
      this.prisma.apiUsageEvent.count({ where: dateWhere }),
      this.prisma.apiUsageEvent.count({
        where: { ...dateWhere, statusCode: { gte: 400 } },
      }),
      this.prisma.apiKey.count({
        where: {
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      }),
      this.prisma.apiUsageEvent.groupBy({
        by: ['workspaceId'],
        where: dateWhere,
        _count: { _all: true },
        orderBy: { _count: { workspaceId: 'desc' } },
        take: 10,
      }),
      this.prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
          SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
          FROM "api_usage_events"
          WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
          GROUP BY day
          ORDER BY day ASC
        `,
    ]);

    const workspaces = await this.prisma.workspace.findMany({
      where: { id: { in: topWorkspacesRaw.map((r) => r.workspaceId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(workspaces.map((w) => [w.id, w.name]));

    return {
      totalRequests,
      failedRequests,
      activeApiKeys,
      requestsOverTime: dailyRows.map((row) => ({
        date: row.day.toISOString().slice(0, 10),
        count: Number(row.count),
      })),
      topWorkspaces: topWorkspacesRaw.map((row) => ({
        workspaceId: row.workspaceId,
        workspaceName: nameById.get(row.workspaceId) ?? 'Unknown workspace',
        requests: row._count._all,
      })),
    };
  }
}
