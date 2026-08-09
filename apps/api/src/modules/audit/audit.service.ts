import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

export interface RecordAuditEventInput {
  action: string;
  entity: string;
  entityId?: string;
  userId?: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
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
