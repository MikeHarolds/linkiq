import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

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
}
