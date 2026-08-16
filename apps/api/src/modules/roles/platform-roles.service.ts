import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PlatformRole } from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import { RESERVED_ROLE_SLUGS, type CreateRoleDto } from './dto/create-role.dto';
import type { UpdateRoleDto } from './dto/update-role.dto';

export type PlatformRoleWithDetail = PlatformRole & {
  permissions: string[];
  userCount: number;
  plans: Array<{ id: string; name: string; slug: string }>;
};

const ROLE_WITH_DETAIL_INCLUDE = {
  permissions: true,
  plans: { select: { id: true, name: true, slug: true } },
  _count: { select: { users: true } },
} satisfies Prisma.PlatformRoleInclude;

function toDetail(
  row: PlatformRole & {
    permissions: { permission: string }[];
    plans: Array<{ id: string; name: string; slug: string }>;
    _count: { users: number };
  },
): PlatformRoleWithDetail {
  const { permissions, _count, ...rest } = row;
  return {
    ...rest,
    permissions: permissions.map((p) => p.permission),
    userCount: _count.users,
    plans: row.plans,
  };
}

/**
 * Super Admin platform-role management (Sprint 15). Mirrors PlansService/
 * LandingPageService's own conventions — deactivate is the universal safe
 * "remove" (isSystem roles can never even be deactivated, since a seeded
 * plan or a currently-resolved user role could silently lose its
 * permissions), hard-delete only for a custom role nobody currently
 * depends on.
 */
@Injectable()
export class PlatformRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listAll(): Promise<PlatformRoleWithDetail[]> {
    const rows = await this.prisma.platformRole.findMany({
      include: ROLE_WITH_DETAIL_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return rows.map(toDetail);
  }

  async getByIdOrThrow(id: string): Promise<PlatformRoleWithDetail> {
    const row = await this.prisma.platformRole.findUnique({
      where: { id },
      include: ROLE_WITH_DETAIL_INCLUDE,
    });
    if (!row) {
      throw new NotFoundException('Role not found');
    }
    return toDetail(row);
  }

  async create(dto: CreateRoleDto, adminUserId: string, ctx: RequestContext): Promise<PlatformRoleWithDetail> {
    if (RESERVED_ROLE_SLUGS.includes(dto.slug)) {
      throw new BadRequestException('This slug is reserved and cannot be used for a custom role');
    }
    const existing = await this.prisma.platformRole.findFirst({
      where: { OR: [{ slug: dto.slug }, { name: dto.name }] },
    });
    if (existing) {
      throw new ConflictException('A role with this name or slug already exists');
    }

    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.platformRole.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          isActive: dto.isActive ?? true,
          isSystem: false,
        },
      });
      const permissions = [...new Set(dto.permissions ?? [])];
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ platformRoleId: created.id, permission })),
        });
      }
      return created;
    });

    await this.audit.record({
      action: 'admin.role_created',
      entity: 'PlatformRole',
      entityId: role.id,
      userId: adminUserId,
      metadata: { name: role.name, slug: role.slug, permissions: dto.permissions ?? [] },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.getByIdOrThrow(role.id);
  }

  /** name/description/isActive/permissions are all editable on a system
   * role (a Super Admin may legitimately want to change what FREE_USER
   * grants) — only the slug (immutable for every role) and isSystem
   * itself are protected. */
  async update(
    id: string,
    dto: UpdateRoleDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<PlatformRoleWithDetail> {
    const existing = await this.prisma.platformRole.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Role not found');
    }
    if (dto.name && dto.name !== existing.name) {
      const nameTaken = await this.prisma.platformRole.findFirst({
        where: { name: dto.name, id: { not: id } },
      });
      if (nameTaken) {
        throw new ConflictException('A role with this name already exists');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.platformRole.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          isActive: dto.isActive,
        },
      });

      if (dto.permissions) {
        const permissions = [...new Set(dto.permissions)];
        await tx.rolePermission.deleteMany({ where: { platformRoleId: id } });
        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map((permission) => ({ platformRoleId: id, permission })),
          });
        }
      }
    });

    await this.audit.record({
      action: 'admin.role_updated',
      entity: 'PlatformRole',
      entityId: id,
      userId: adminUserId,
      metadata: JSON.parse(JSON.stringify({ changes: dto })) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    if (dto.isActive === false && existing.isActive) {
      await this.audit.record({
        action: 'admin.role_deactivated',
        entity: 'PlatformRole',
        entityId: id,
        userId: adminUserId,
        metadata: { name: existing.name },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    } else if (dto.isActive === true && !existing.isActive) {
      await this.audit.record({
        action: 'admin.role_activated',
        entity: 'PlatformRole',
        entityId: id,
        userId: adminUserId,
        metadata: { name: existing.name },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
    }

    return this.getByIdOrThrow(id);
  }

  /** Hard-delete — only ever safe for a custom role with zero current
   * dependents. A system role is rejected outright, regardless of
   * dependents, since FREE_USER/etc. are load-bearing seed data every
   * fallback resolution can reach for (see RoleResolutionService). A
   * custom role still referenced by a Plan or an assigned User is
   * rejected with a clear message rather than silently deactivated —
   * the caller (admin UI) should offer deactivate as the alternative,
   * not have delete quietly downgrade to it. */
  async delete(id: string, adminUserId: string, ctx: RequestContext): Promise<void> {
    const role = await this.prisma.platformRole.findUnique({
      where: { id },
      include: { _count: { select: { users: true, plans: true } } },
    });
    if (!role) {
      throw new NotFoundException('Role not found');
    }
    if (role.isSystem) {
      throw new BadRequestException('System roles cannot be deleted — deactivate it instead');
    }
    if (role._count.users > 0 || role._count.plans > 0) {
      throw new BadRequestException(
        `This role is still assigned to ${role._count.users} user(s) and ${role._count.plans} plan(s) — deactivate it instead of deleting`,
      );
    }

    await this.prisma.platformRole.delete({ where: { id } });

    await this.audit.record({
      action: 'admin.role_archived',
      entity: 'PlatformRole',
      entityId: id,
      userId: adminUserId,
      metadata: { name: role.name, slug: role.slug },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}
