import { Injectable, NotFoundException } from '@nestjs/common';
import { WebhookDeliveryStatus } from '@prisma/client';

import type { RequestContext } from '../../../common/decorators/request-context.decorator';
import {
  paginationMeta,
  type PaginatedResult,
} from '../../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhooksService } from '../../webhooks/webhooks.service';

export interface WebhookOpsOverview {
  endpointCount: number;
  activeEndpointCount: number;
  deliveriesByStatus: Record<WebhookDeliveryStatus, number>;
  successRate: number | null;
  recentEvents: Array<{
    id: string;
    type: string;
    workspaceId: string;
    workspaceName: string;
    createdAt: Date;
  }>;
}

export interface AdminWebhookEndpointListItem {
  id: string;
  name: string;
  url: string;
  status: string;
  workspaceId: string;
  workspaceName: string;
  consecutiveFailures: number;
  lastDeliveryAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
}

/**
 * Platform-wide webhook operations visibility (Sprint 11 — Super
 * Admin). Aggregate reads only — retries and everything else that
 * mutates a delivery go back through WebhooksService.retryDelivery
 * (Sprint 9's own delivery infra), never a parallel implementation. No
 * webhook secret is ever selected by any query here (see
 * WebhooksService's SAFE_SELECT, reused for the same reason
 * AdminApiUsageService reuses ApiKeysService's).
 */
@Injectable()
export class AdminWebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  async getOverview(from: Date, to: Date): Promise<WebhookOpsOverview> {
    const [endpointCount, activeEndpointCount, statusGroups, recentEvents] =
      await Promise.all([
        this.prisma.webhookEndpoint.count({ where: { deletedAt: null } }),
        this.prisma.webhookEndpoint.count({
          where: { deletedAt: null, status: 'ACTIVE' },
        }),
        this.prisma.webhookDelivery.groupBy({
          by: ['status'],
          where: { createdAt: { gte: from, lte: to } },
          _count: { _all: true },
        }),
        this.prisma.webhookEvent.findMany({
          where: { createdAt: { gte: from, lte: to } },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { workspace: { select: { name: true } } },
        }),
      ]);

    const deliveriesByStatus = {
      PENDING: 0,
      PROCESSING: 0,
      DELIVERED: 0,
      FAILED: 0,
      EXHAUSTED: 0,
    } satisfies Record<WebhookDeliveryStatus, number>;
    for (const row of statusGroups) {
      deliveriesByStatus[row.status] = row._count._all;
    }
    const terminal =
      deliveriesByStatus.DELIVERED +
      deliveriesByStatus.FAILED +
      deliveriesByStatus.EXHAUSTED;
    const successRate =
      terminal === 0 ? null : deliveriesByStatus.DELIVERED / terminal;

    return {
      endpointCount,
      activeEndpointCount,
      deliveriesByStatus,
      successRate,
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        type: e.type,
        workspaceId: e.workspaceId,
        workspaceName: e.workspace.name,
        createdAt: e.createdAt,
      })),
    };
  }

  async listEndpoints(
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<AdminWebhookEndpointListItem>> {
    const where = { deletedAt: null } as const;
    const [rows, totalItems] = await Promise.all([
      this.prisma.webhookEndpoint.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { workspace: { select: { id: true, name: true } } },
      }),
      this.prisma.webhookEndpoint.count({ where }),
    ]);

    return {
      items: rows.map((e) => ({
        id: e.id,
        name: e.name,
        url: e.url,
        status: e.status,
        workspaceId: e.workspaceId,
        workspaceName: e.workspace.name,
        consecutiveFailures: e.consecutiveFailures,
        lastDeliveryAt: e.lastDeliveryAt,
        lastSuccessAt: e.lastSuccessAt,
        lastFailureAt: e.lastFailureAt,
        createdAt: e.createdAt,
      })),
      pagination: paginationMeta(page, pageSize, totalItems),
    };
  }

  private async workspaceIdForEndpoint(endpointId: string): Promise<string> {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({
      where: { id: endpointId, deletedAt: null },
      select: { workspaceId: true },
    });
    if (!endpoint) {
      throw new NotFoundException('Webhook endpoint not found');
    }
    return endpoint.workspaceId;
  }

  async listDeliveries(
    endpointId: string,
    page: number,
    pageSize: number,
    status?: WebhookDeliveryStatus,
  ) {
    const workspaceId = await this.workspaceIdForEndpoint(endpointId);
    return this.webhooks.listDeliveries(workspaceId, endpointId, {
      page,
      pageSize,
      status,
    });
  }

  async getDelivery(endpointId: string, deliveryId: string) {
    const workspaceId = await this.workspaceIdForEndpoint(endpointId);
    return this.webhooks.getDeliveryOrThrow(
      workspaceId,
      endpointId,
      deliveryId,
    );
  }

  async retryDelivery(
    endpointId: string,
    deliveryId: string,
    adminUserId: string,
    ctx: RequestContext,
  ) {
    const workspaceId = await this.workspaceIdForEndpoint(endpointId);
    return this.webhooks.retryDelivery(
      workspaceId,
      endpointId,
      deliveryId,
      adminUserId,
      ctx,
    );
  }
}
