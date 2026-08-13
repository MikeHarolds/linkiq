import { Injectable, NotFoundException } from '@nestjs/common';
import { WebhookEventType, type ApiKey } from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { generateApiKey } from '../../common/utils/api-key';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookEventsService } from '../webhooks/webhook-events.service';

import type { CreateApiKeyDto } from './dto/create-api-key.dto';

export type SafeApiKey = Omit<ApiKey, 'keyHash'>;

/** Every field except keyHash, explicit rather than an omit — the one
 * column that must never leave this service, enforced at the query
 * layer, not just by convention in a response mapper. */
const SAFE_SELECT = {
  id: true,
  workspaceId: true,
  name: true,
  keyPrefix: true,
  permissions: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly webhookEvents: WebhookEventsService,
  ) {}

  /**
   * Creates a key and returns the one and only response that will ever
   * contain the raw secret. Nothing about the raw key is persisted,
   * logged, or audited — only name/prefix/permissions are.
   */
  async create(
    workspaceId: string,
    userId: string,
    dto: CreateApiKeyDto,
    ctx: RequestContext,
  ): Promise<SafeApiKey & { key: string }> {
    const { rawKey, keyPrefix, keyHash } = generateApiKey();

    const apiKey = await this.prisma.apiKey.create({
      data: {
        workspaceId,
        name: dto.name,
        keyPrefix,
        keyHash,
        permissions: dto.permissions,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdById: userId,
      },
      select: SAFE_SELECT,
    });

    await this.audit.record({
      action: 'api_key.created',
      entity: 'ApiKey',
      entityId: apiKey.id,
      userId,
      workspaceId,
      metadata: {
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        permissions: apiKey.permissions,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.API_KEY_CREATED,
      workspaceId,
      resourceId: apiKey.id,
      data: {
        id: apiKey.id,
        name: apiKey.name,
        keyPrefix: apiKey.keyPrefix,
        permissions: apiKey.permissions,
      },
    });

    return { ...apiKey, key: rawKey };
  }

  async findAll(workspaceId: string): Promise<SafeApiKey[]> {
    return this.prisma.apiKey.findMany({
      where: { workspaceId },
      select: SAFE_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByIdOrThrow(workspaceId: string, id: string): Promise<SafeApiKey> {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id, workspaceId },
      select: SAFE_SELECT,
    });
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }
    return apiKey;
  }

  /** Idempotent — revoking an already-revoked key is a no-op, not an
   * error, matching AuthService.logout's style for an already-cleared
   * session. */
  async revoke(
    workspaceId: string,
    id: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<SafeApiKey> {
    const existing = await this.findByIdOrThrow(workspaceId, id);
    if (existing.revokedAt) {
      return existing;
    }

    const apiKey = await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: SAFE_SELECT,
    });

    await this.audit.record({
      action: 'api_key.revoked',
      entity: 'ApiKey',
      entityId: apiKey.id,
      userId,
      workspaceId,
      metadata: { name: apiKey.name, keyPrefix: apiKey.keyPrefix },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.API_KEY_REVOKED,
      workspaceId,
      resourceId: apiKey.id,
      data: { id: apiKey.id, name: apiKey.name, keyPrefix: apiKey.keyPrefix },
    });

    return apiKey;
  }

  async remove(
    workspaceId: string,
    id: string,
    userId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const existing = await this.findByIdOrThrow(workspaceId, id);

    await this.prisma.apiKey.delete({ where: { id: existing.id } });

    await this.audit.record({
      action: 'api_key.deleted',
      entity: 'ApiKey',
      entityId: existing.id,
      userId,
      workspaceId,
      metadata: { name: existing.name, keyPrefix: existing.keyPrefix },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    await this.webhookEvents.emit({
      type: WebhookEventType.API_KEY_DELETED,
      workspaceId,
      resourceId: existing.id,
      data: { id: existing.id, name: existing.name, keyPrefix: existing.keyPrefix },
    });
  }
}
