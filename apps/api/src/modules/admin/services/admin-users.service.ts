import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkspaceRole, type GlobalRole } from '@prisma/client';

import type { RequestContext } from '../../../common/decorators/request-context.decorator';
import {
  paginationMeta,
  type PaginatedResult,
} from '../../../common/dto/pagination.dto';
import { AuditService } from '../../audit/audit.service';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { QueryUsersDto } from '../dto/query-users.dto';

/** Never includes passwordHash — every shape below is built from an
 * explicit Prisma `select`, not a raw `User` row, so there is no field
 * to accidentally forget to strip. */
export interface AdminUserListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  globalRole: GlobalRole;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: Date;
  workspaceCount: number;
  lastLoginAt: Date | null;
}

export interface AdminUserDetail extends AdminUserListItem {
  updatedAt: Date;
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    role: WorkspaceRole;
    planName: string | null;
    planSlug: string | null;
    subscriptionStatus: string | null;
  }>;
}

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  globalRole: true,
  isActive: true,
  emailVerified: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

/**
 * Platform-wide user management (Sprint 11 — Super Admin). A genuinely
 * new service — `UsersService` (users.module.ts) is self-service only
 * (operates on the caller's own userId via @CurrentUser()), so it has no
 * "list everyone"/"look up any user"/"suspend" methods to extend; adding
 * them there would blur a self-service module into an admin one. This
 * service reuses `isActive` (already fully enforced end-to-end by
 * JwtStrategy/AuthService — see auth.service.ts) for suspension rather
 * than adding a new column, and `AuthService.revokeAllSessions` for
 * force-logout — both pre-existing primitives, not new mechanisms.
 * "Last login" is derived from the AuditLog `auth.login_succeeded`
 * action (already recorded on every login) rather than a new
 * `lastLoginAt` column, keeping this sprint's schema footprint at zero.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
  ) {}

  async list(
    query: QueryUsersDto,
  ): Promise<PaginatedResult<AdminUserListItem>> {
    const searchTerm = query.search?.trim();
    const isActive =
      query.isActive === undefined ? undefined : query.isActive === 'true';

    const where: Prisma.UserWhereInput = {
      ...(query.globalRole ? { globalRole: query.globalRole } : {}),
      ...(isActive === undefined ? {} : { isActive }),
      ...(searchTerm
        ? {
            OR: [
              { email: { contains: searchTerm, mode: 'insensitive' } },
              { firstName: { contains: searchTerm, mode: 'insensitive' } },
              { lastName: { contains: searchTerm, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [users, totalItems] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: { ...USER_SELECT, _count: { select: { memberships: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    const lastLogins = await this.latestLoginsFor(users.map((u) => u.id));

    return {
      items: users.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        avatarUrl: u.avatarUrl,
        globalRole: u.globalRole,
        isActive: u.isActive,
        emailVerified: u.emailVerified,
        createdAt: u.createdAt,
        workspaceCount: u._count.memberships,
        lastLoginAt: lastLogins.get(u.id) ?? null,
      })),
      pagination: paginationMeta(query.page, query.pageSize, totalItems),
    };
  }

  async getDetail(userId: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ...USER_SELECT, _count: { select: { memberships: true } } },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: {
        workspace: {
          include: { subscription: { include: { plan: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const [lastLoginAt] = (await this.latestLoginsFor([userId])).values();

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      globalRole: user.globalRole,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      workspaceCount: user._count.memberships,
      lastLoginAt: lastLoginAt ?? null,
      workspaces: memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        role: m.role,
        planName: m.workspace.subscription?.plan.name ?? null,
        planSlug: m.workspace.subscription?.plan.slug ?? null,
        subscriptionStatus: m.workspace.subscription?.status ?? null,
      })),
    };
  }

  /** Deactivates the account (JwtStrategy/AuthService already gate every
   * login/refresh/reset-password path on `isActive` — see their docs)
   * and immediately revokes every live session, so access ends within
   * this request, not just at the next token expiry. */
  async suspend(
    userId: string,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<void> {
    if (userId === adminUserId) {
      throw new BadRequestException('You cannot suspend your own account');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });
    await this.authService.revokeAllSessions(userId);

    await this.audit.record({
      action: 'admin.user_suspended',
      entity: 'User',
      entityId: userId,
      userId: adminUserId,
      metadata: { targetEmail: user.email },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async reactivate(
    userId: string,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });

    await this.audit.record({
      action: 'admin.user_reactivated',
      entity: 'User',
      entityId: userId,
      userId: adminUserId,
      metadata: { targetEmail: user.email },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /** Revokes every refresh token without touching `isActive` — the
   * account stays enabled, only its currently-live sessions end (the
   * user can simply log in again), unlike suspend(). */
  async forceLogout(
    userId: string,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.authService.revokeAllSessions(userId);

    await this.audit.record({
      action: 'admin.user_force_logout',
      entity: 'User',
      entityId: userId,
      userId: adminUserId,
      metadata: { targetEmail: user.email },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async getUserAuditActivity(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<
    PaginatedResult<{
      id: string;
      action: string;
      entity: string;
      createdAt: Date;
      metadata: unknown;
    }>
  > {
    const where: Prisma.AuditLogWhereInput = { userId };
    const [items, totalItems] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          action: true,
          entity: true,
          createdAt: true,
          metadata: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, pagination: paginationMeta(page, pageSize, totalItems) };
  }

  private async latestLoginsFor(userIds: string[]): Promise<Map<string, Date>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.auditLog.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, action: 'auth.login_succeeded' },
      _max: { createdAt: true },
    });
    const map = new Map<string, Date>();
    for (const row of rows) {
      if (row.userId && row._max.createdAt) {
        map.set(row.userId, row._max.createdAt);
      }
    }
    return map;
  }
}
