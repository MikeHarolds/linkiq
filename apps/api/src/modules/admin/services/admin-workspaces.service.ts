import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  paginationMeta,
  type PaginatedResult,
} from '../../../common/dto/pagination.dto';
import {
  ApiKeysService,
  type SafeApiKey,
} from '../../api-keys/api-keys.service';
import {
  AuditService,
  type AuditLogWithContext,
} from '../../audit/audit.service';
import {
  BillingUsageService,
  type UsageSnapshot,
} from '../../billing/billing-usage.service';
import { DomainsService } from '../../domains/domains.service';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhooksService } from '../../webhooks/webhooks.service';
import type { QueryWorkspacesDto } from '../dto/query-workspaces.dto';

export interface AdminWorkspaceListItem {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  organizationName: string;
  owner: { id: string; email: string; firstName: string; lastName: string };
  memberCount: number;
  linkCount: number;
  domainCount: number;
  planName: string | null;
  planSlug: string | null;
  subscriptionStatus: string | null;
}

export interface AdminWorkspaceDetail extends AdminWorkspaceListItem {
  members: Array<{
    id: string;
    role: string;
    user: { id: string; email: string; firstName: string; lastName: string };
  }>;
  subscription: unknown;
  usage: UsageSnapshot[];
  domains: Array<{
    id: string;
    domain: string;
    status: string;
    isPrimary: boolean;
  }>;
  apiKeys: Array<SafeApiKey & { status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' }>;
  webhookEndpoints: Array<{
    id: string;
    name: string;
    url: string;
    status: string;
  }>;
  recentAudit: AuditLogWithContext[];
}

/** Mirrors ApiKeysController's own deriveStatus exactly (see
 * api-keys.controller.ts) — kept in sync deliberately rather than
 * imported, since that function is private to its controller file. */
function deriveApiKeyStatus(
  apiKey: SafeApiKey,
): 'ACTIVE' | 'EXPIRED' | 'REVOKED' {
  if (apiKey.revokedAt) return 'REVOKED';
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now())
    return 'EXPIRED';
  return 'ACTIVE';
}

const WORKSPACE_LIST_INCLUDE = {
  organization: {
    select: {
      name: true,
      owner: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
  },
  subscription: {
    select: { status: true, plan: { select: { name: true, slug: true } } },
  },
  _count: { select: { members: true, links: true, customDomains: true } },
} satisfies Prisma.WorkspaceInclude;

type WorkspaceListRow = Prisma.WorkspaceGetPayload<{
  include: typeof WORKSPACE_LIST_INCLUDE;
}>;

function toListItem(w: WorkspaceListRow): AdminWorkspaceListItem {
  return {
    id: w.id,
    name: w.name,
    slug: w.slug,
    createdAt: w.createdAt,
    organizationName: w.organization.name,
    owner: w.organization.owner,
    memberCount: w._count.members,
    linkCount: w._count.links,
    domainCount: w._count.customDomains,
    planName: w.subscription?.plan.name ?? null,
    planSlug: w.subscription?.plan.slug ?? null,
    subscriptionStatus: w.subscription?.status ?? null,
  };
}

/**
 * Platform-wide workspace visibility (Sprint 11 — Super Admin). Read-only
 * aggregation across existing modules — no parallel write path exists
 * here; every service this injects (BillingUsageService, DomainsService,
 * ApiKeysService, WebhooksService, AuditService) is the exact one the
 * customer-facing dashboard already uses, so a workspace's admin-visible
 * state can never drift from what its own OWNER/ADMIN sees.
 */
@Injectable()
export class AdminWorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingUsage: BillingUsageService,
    private readonly domains: DomainsService,
    private readonly apiKeys: ApiKeysService,
    private readonly webhooks: WebhooksService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: QueryWorkspacesDto,
  ): Promise<PaginatedResult<AdminWorkspaceListItem>> {
    const searchTerm = query.search?.trim();
    const where: Prisma.WorkspaceWhereInput = {
      ...(query.planSlug
        ? { subscription: { plan: { slug: query.planSlug } } }
        : {}),
      ...(searchTerm
        ? {
            OR: [
              { name: { contains: searchTerm, mode: 'insensitive' } },
              { slug: { contains: searchTerm, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.workspace.findMany({
        where,
        include: WORKSPACE_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.workspace.count({ where }),
    ]);

    return {
      items: rows.map(toListItem),
      pagination: paginationMeta(query.page, query.pageSize, totalItems),
    };
  }

  async getDetail(workspaceId: string): Promise<AdminWorkspaceDetail> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        ...WORKSPACE_LIST_INCLUDE,
        members: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        subscription: { include: { plan: { include: { limits: true } } } },
        customDomains: {
          where: { deletedAt: null },
          select: { id: true, domain: true, status: true, isPrimary: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const [usage, apiKeys, webhookEndpoints, recentAudit] = await Promise.all([
      this.billingUsage.getUsage(workspaceId),
      this.apiKeys.findAll(workspaceId),
      this.webhooks.findAll(workspaceId),
      this.audit.list({ page: 1, pageSize: 20, workspaceId }),
    ]);

    return {
      ...toListItem(workspace),
      members: workspace.members.map((m) => ({
        id: m.id,
        role: m.role,
        user: m.user,
      })),
      subscription: workspace.subscription,
      usage,
      domains: workspace.customDomains,
      apiKeys: apiKeys.map((k) => ({ ...k, status: deriveApiKeyStatus(k) })),
      webhookEndpoints: webhookEndpoints.map((e) => ({
        id: e.id,
        name: e.name,
        url: e.url,
        status: e.status,
      })),
      recentAudit: recentAudit.items,
    };
  }
}
