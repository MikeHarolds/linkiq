import { Injectable } from '@nestjs/common';
import { Prisma, type AuditLog } from '@prisma/client';

import {
  paginationMeta,
  type PaginatedResult,
} from '../../common/dto/pagination.dto';
import { PrismaService } from '../prisma/prisma.service';

export type AuditLogWithContext = AuditLog & {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
  } | null;
  workspace: { id: string; name: string; slug: string } | null;
};

export interface ListAuditLogsQuery {
  page: number;
  pageSize: number;
  userId?: string;
  workspaceId?: string;
  action?: string;
  entity?: string;
  /** Matches against action/entity/entityId (case-insensitive). */
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export interface RecordAuditEventInput {
  action: string;
  entity: string;
  entityId?: string;
  userId?: string;
  workspaceId?: string;
  /**
   * Must be genuinely JSON-serializable — `Prisma.InputJsonValue` is the
   * precise type Prisma's generated client expects for a nullable Json
   * field's create input (unlike `Record<string, unknown>`, whose values
   * are typed `unknown` and therefore not provably JSON-safe: `unknown`
   * could be a Date, a function, a Symbol, none of which round-trip
   * through JSON). Every existing call site already passes plain
   * string/number/array/object literals, so this is a more accurate type
   * for what was always actually required, not a behavior change.
   */
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Centralized audit-log writer. Every security-sensitive action across
 * every module goes through this service so the shape (and the rule that
 * we never log secrets) is enforced in exactly one place.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEventInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        metadata: input.metadata,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  }

  /**
   * Platform-wide audit search (Sprint 11 — Super Admin). `record()`
   * above already writes both workspace-scoped AND platform-level
   * entries (both `userId`/`workspaceId` are nullable on the model), so
   * no schema change was needed — this is purely a new read path over
   * data every module already produces. Never returns `metadata` values
   * containing secrets because no call site has ever written any (see
   * `record()`'s own doc comment) — this method doesn't need its own
   * redaction step, it inherits the guarantee.
   */
  async list(
    query: ListAuditLogsQuery,
  ): Promise<PaginatedResult<AuditLogWithContext>> {
    const searchTerm = query.search?.trim();
    const where: Prisma.AuditLogWhereInput = {
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
      ...(searchTerm
        ? {
            OR: [
              { action: { contains: searchTerm, mode: 'insensitive' } },
              { entity: { contains: searchTerm, mode: 'insensitive' } },
              { entityId: { contains: searchTerm, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, totalItems] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          workspace: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      pagination: paginationMeta(query.page, query.pageSize, totalItems),
    };
  }
}
