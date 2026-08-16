import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlanTier, RoleAssignmentSource, WorkspaceRole, type PlatformRole } from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import { getEffectiveStatus, isEffectivelyOnPlan } from '../billing/utils/effective-status';
import { PrismaService } from '../prisma/prisma.service';

export const FREE_USER_ROLE_SLUG = 'free-user';

export interface ResolvedRole {
  platformRoleId: string | null;
  roleSlug: string | null;
  source: RoleAssignmentSource;
  /** The owned workspace whose subscription produced this result — null
   * for an admin override or the system-default fallback. */
  workspaceId: string | null;
}

function tierRank(tier: PlanTier): number {
  switch (tier) {
    case PlanTier.ENTERPRISE:
      return 4;
    case PlanTier.BUSINESS:
      return 3;
    case PlanTier.PROFESSIONAL:
      return 2;
    case PlanTier.STARTER:
      return 1;
    case PlanTier.FREE:
      return 0;
    default:
      throw new Error(`Unknown plan tier: ${String(tier)}`);
  }
}

/**
 * Single source of truth for platformRole resolution (Sprint 15) —
 * every other module (SubscriptionsService, PaystackWebhookProcessor,
 * the admin roles/users controllers, the seed script) calls into this
 * service rather than writing User.platformRoleId/roleAssignmentSource
 * directly. See docs/architecture/roles-and-permissions.md for the full
 * model.
 *
 * Resolution order, mirroring getEffectiveStatus's own lazy/derived
 * philosophy (no cron, no eagerly-corrected background job — see that
 * file's docs) rather than inventing new scheduled infrastructure:
 *
 *   1. ADMIN_ASSIGNED override — if the user's current
 *      roleAssignmentSource is ADMIN_ASSIGNED, that assignment is
 *      returned as-is. Subscription lifecycle events must never
 *      silently overwrite it (Part 14 of the sprint spec) — only
 *      clearManualRole() (an explicit admin action) removes it.
 *   2. Subscription-derived — the highest-tier plan, among every
 *      workspace this user OWNS, that is both (a) effectively active
 *      right now (TRIALING/ACTIVE/PAST_DUE, via the existing
 *      getEffectiveStatus) and (b) has a platformRoleId attached to an
 *      active PlatformRole. A user can own more than one workspace (no
 *      "primary workspace" concept exists anywhere in the schema — see
 *      WorkspacesService.create) — highest tier wins, so owning even
 *      one Business-plan workspace never leaves a user under-entitled
 *      because an older Free workspace was found first.
 *   3. SYSTEM_DEFAULT fallback — the seeded FREE_USER role, when
 *      nothing above produced a result (no owned workspace, or no
 *      owned workspace is effectively on a role-bearing plan).
 */
@Injectable()
export class RoleResolutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private get pastDueGraceDays(): number {
    return this.config.get<number>('paystack.pastDueGraceDays') ?? 7;
  }

  /** Pure computation — never writes anything. See syncStoredRole() for
   * the write path. */
  async resolveEffectiveRole(userId: string): Promise<ResolvedRole> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        platformRoleId: true,
        roleAssignmentSource: true,
        platformRole: { select: { id: true, slug: true, isActive: true } },
      },
    });

    if (
      user.roleAssignmentSource === RoleAssignmentSource.ADMIN_ASSIGNED &&
      user.platformRoleId
    ) {
      return {
        platformRoleId: user.platformRoleId,
        roleSlug: user.platformRole?.slug ?? null,
        source: RoleAssignmentSource.ADMIN_ASSIGNED,
        workspaceId: null,
      };
    }

    return this.resolveFromSubscriptions(userId);
  }

  /** Ignores any current ADMIN_ASSIGNED override — used by
   * clearManualRole() to compute what the role *would* be from
   * subscriptions alone. */
  private async resolveFromSubscriptions(userId: string): Promise<ResolvedRole> {
    const ownedMemberships = await this.prisma.workspaceMember.findMany({
      where: { userId, role: WorkspaceRole.OWNER },
      select: {
        workspace: {
          select: {
            id: true,
            subscription: {
              select: {
                status: true,
                trialEnd: true,
                cancelAt: true,
                pastDueSince: true,
                plan: {
                  select: {
                    tier: true,
                    platformRoleId: true,
                    platformRole: { select: { id: true, slug: true, isActive: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    let best: { rank: number; platformRoleId: string; roleSlug: string; workspaceId: string } | null = null;

    for (const { workspace } of ownedMemberships) {
      const sub = workspace.subscription;
      if (!sub || !sub.plan.platformRoleId || !sub.plan.platformRole?.isActive) {
        continue;
      }
      const effectiveStatus = getEffectiveStatus(sub, new Date(), this.pastDueGraceDays);
      if (!isEffectivelyOnPlan(effectiveStatus)) {
        continue;
      }
      const rank = tierRank(sub.plan.tier);
      if (!best || rank > best.rank) {
        best = {
          rank,
          platformRoleId: sub.plan.platformRoleId,
          roleSlug: sub.plan.platformRole.slug,
          workspaceId: workspace.id,
        };
      }
    }

    if (best) {
      return {
        platformRoleId: best.platformRoleId,
        roleSlug: best.roleSlug,
        source: RoleAssignmentSource.SUBSCRIPTION,
        workspaceId: best.workspaceId,
      };
    }

    const freeRole = await this.prisma.platformRole.findUnique({
      where: { slug: FREE_USER_ROLE_SLUG },
      select: { id: true, slug: true },
    });

    return {
      platformRoleId: freeRole?.id ?? null,
      roleSlug: freeRole?.slug ?? null,
      source: RoleAssignmentSource.SYSTEM_DEFAULT,
      workspaceId: null,
    };
  }

  /**
   * Resolves and writes the result to User.platformRoleId/
   * roleAssignmentSource — the only method in the codebase that does.
   * Idempotent: a no-op (no write, no audit) when the resolved role
   * already matches what's stored, so repeated Paystack webhook
   * delivery or repeated calls from any other trigger point never
   * produce duplicate audit rows or redundant writes. Call this after
   * every event that could change a user's effective entitlement —
   * see SubscriptionsService and PaystackWebhookProcessor.
   */
  async syncStoredRole(userId: string, ctx?: RequestContext): Promise<ResolvedRole> {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { platformRoleId: true, roleAssignmentSource: true },
    });

    const resolved = await this.resolveEffectiveRole(userId);

    if (
      current.platformRoleId === resolved.platformRoleId &&
      current.roleAssignmentSource === resolved.source
    ) {
      return resolved;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        platformRoleId: resolved.platformRoleId,
        roleAssignmentSource: resolved.source,
      },
    });

    await this.audit.record({
      action:
        resolved.source === RoleAssignmentSource.SYSTEM_DEFAULT
          ? 'role.fallback_applied'
          : 'role.subscription_role_assigned',
      entity: 'User',
      entityId: userId,
      workspaceId: resolved.workspaceId ?? undefined,
      metadata: {
        previousRoleId: current.platformRoleId,
        newRoleId: resolved.platformRoleId,
        newRoleSlug: resolved.roleSlug,
        source: resolved.source,
      },
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    });

    return resolved;
  }

  /** Super Admin override — sets roleAssignmentSource to ADMIN_ASSIGNED,
   * which resolveEffectiveRole() then treats as sticky until
   * clearManualRole() is called. */
  async assignManualRole(
    userId: string,
    platformRoleId: string,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<ResolvedRole> {
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, platformRoleId: true } }),
      this.prisma.platformRole.findUnique({ where: { id: platformRoleId } }),
    ]);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (!role.isActive) {
      throw new BadRequestException('Cannot assign an inactive role');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { platformRoleId: role.id, roleAssignmentSource: RoleAssignmentSource.ADMIN_ASSIGNED },
    });

    await this.audit.record({
      action: 'admin.user_role_assigned',
      entity: 'User',
      entityId: userId,
      userId: adminUserId,
      metadata: { previousRoleId: user.platformRoleId, newRoleId: role.id, newRoleSlug: role.slug },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return {
      platformRoleId: role.id,
      roleSlug: role.slug,
      source: RoleAssignmentSource.ADMIN_ASSIGNED,
      workspaceId: null,
    };
  }

  /** Removes an ADMIN_ASSIGNED override and immediately re-resolves from
   * the user's current subscription state (or the SYSTEM_DEFAULT
   * fallback) — "Use subscription role" in the admin UI. A no-op, still
   * audited, when the user had no override to remove. */
  async clearManualRole(userId: string, adminUserId: string, ctx: RequestContext): Promise<ResolvedRole> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, platformRoleId: true, roleAssignmentSource: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const resolved = await this.resolveFromSubscriptions(userId);

    await this.prisma.user.update({
      where: { id: userId },
      data: { platformRoleId: resolved.platformRoleId, roleAssignmentSource: resolved.source },
    });

    await this.audit.record({
      action: 'admin.user_role_override_removed',
      entity: 'User',
      entityId: userId,
      userId: adminUserId,
      metadata: {
        previousRoleId: user.platformRoleId,
        newRoleId: resolved.platformRoleId,
        newRoleSlug: resolved.roleSlug,
        newSource: resolved.source,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return resolved;
  }

  /** Every PlatformRole a user could theoretically be assigned via the
   * admin UI, including inactive-but-not-system roles filtered out —
   * used to populate the "Assign Role" selector. */
  async listAssignableRoles(): Promise<PlatformRole[]> {
    return this.prisma.platformRole.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }
}
