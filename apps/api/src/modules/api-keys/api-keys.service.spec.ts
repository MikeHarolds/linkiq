import { NotFoundException } from '@nestjs/common';
import type { ApiKeyPermission } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';

import { ApiKeysService } from './api-keys.service';
import type { CreateApiKeyDto } from './dto/create-api-key.dto';

const ctx: RequestContext = { ipAddress: '127.0.0.1', userAgent: 'jest' };

function makeApiKeyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'key-1',
    workspaceId: 'ws-1',
    name: 'Production Website',
    keyPrefix: 'lk_live_ab12cd34',
    permissions: ['LINKS_READ'] as ApiKeyPermission[],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdById: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ApiKeysService', () => {
  let prisma: MockPrismaService;
  let audit: AuditService;
  let service: ApiKeysService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;
    service = new ApiKeysService(prisma as unknown as PrismaService, audit);
  });

  describe('create', () => {
    const dto: CreateApiKeyDto = {
      name: 'Production Website',
      permissions: ['LINKS_READ', 'LINKS_WRITE'],
    };

    it('generates a key, persists only its hash, and returns the raw secret exactly once', async () => {
      prisma.apiKey.create.mockResolvedValue(makeApiKeyRow());

      const result = await service.create('ws-1', 'user-1', dto, ctx);

      expect(result.key).toMatch(/^lk_live_/);
      const createCall = prisma.apiKey.create.mock.calls[0][0];
      expect(createCall.data.keyHash).toBeDefined();
      expect(createCall.data.keyHash).not.toBe(result.key);
      expect(createCall.data).not.toHaveProperty('key');
    });

    it('never selects keyHash back from the database', async () => {
      prisma.apiKey.create.mockResolvedValue(makeApiKeyRow());

      await service.create('ws-1', 'user-1', dto, ctx);

      const createCall = prisma.apiKey.create.mock.calls[0][0];
      expect(createCall.select).toBeDefined();
      expect(createCall.select.keyHash).toBeUndefined();
    });

    it('stores exactly the permissions supplied, nothing implicit', async () => {
      prisma.apiKey.create.mockResolvedValue(makeApiKeyRow());

      await service.create('ws-1', 'user-1', dto, ctx);

      const createCall = prisma.apiKey.create.mock.calls[0][0];
      expect(createCall.data.permissions).toEqual([
        'LINKS_READ',
        'LINKS_WRITE',
      ]);
    });

    it('audits creation with only the safe prefix — never the full secret or its hash', async () => {
      prisma.apiKey.create.mockResolvedValue(makeApiKeyRow());

      const created = await service.create('ws-1', 'user-1', dto, ctx);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'api_key.created' }),
      );
      const auditCall = (audit.record as jest.Mock).mock.calls[0][0];
      const serialized = JSON.stringify(auditCall);
      // The prefix (e.g. "lk_live_ab12cd34") is intentionally logged —
      // only the full raw secret and the hash must never appear.
      expect(serialized).not.toContain(created.key);
      expect(serialized).not.toMatch(/keyHash/i);
    });

    it('sets expiresAt from the DTO when provided', async () => {
      prisma.apiKey.create.mockResolvedValue(makeApiKeyRow());

      await service.create(
        'ws-1',
        'user-1',
        { ...dto, expiresAt: '2027-01-01T00:00:00.000Z' },
        ctx,
      );

      const createCall = prisma.apiKey.create.mock.calls[0][0];
      expect(createCall.data.expiresAt).toEqual(
        new Date('2027-01-01T00:00:00.000Z'),
      );
    });
  });

  describe('findAll', () => {
    it('lists keys for the workspace, most recent first', async () => {
      prisma.apiKey.findMany.mockResolvedValue([makeApiKeyRow()]);

      const result = await service.findAll('ws-1');

      expect(result).toHaveLength(1);
      expect(prisma.apiKey.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  describe('findByIdOrThrow', () => {
    it('returns the key when found in the workspace', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(makeApiKeyRow());

      const result = await service.findByIdOrThrow('ws-1', 'key-1');

      expect(result.id).toBe('key-1');
    });

    it('throws NotFoundException when absent', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('ws-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException for a key belonging to a different workspace (workspace isolation)', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(
        service.findByIdOrThrow('ws-other', 'key-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.apiKey.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'key-1', workspaceId: 'ws-other' },
        }),
      );
    });
  });

  describe('revoke', () => {
    it('sets revokedAt and audits the action', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(makeApiKeyRow());
      prisma.apiKey.update.mockResolvedValue(
        makeApiKeyRow({ revokedAt: new Date() }),
      );

      const result = await service.revoke('ws-1', 'key-1', 'user-1', ctx);

      expect(result.revokedAt).not.toBeNull();
      expect(prisma.apiKey.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'key-1' },
          data: { revokedAt: expect.any(Date) },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'api_key.revoked' }),
      );
    });

    it('is idempotent — revoking an already-revoked key is a no-op, not an error', async () => {
      const revokedAt = new Date('2026-01-01');
      prisma.apiKey.findFirst.mockResolvedValue(makeApiKeyRow({ revokedAt }));

      const result = await service.revoke('ws-1', 'key-1', 'user-1', ctx);

      expect(result.revokedAt).toEqual(revokedAt);
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the key and audits the action', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(makeApiKeyRow());

      await service.remove('ws-1', 'key-1', 'user-1', ctx);

      expect(prisma.apiKey.delete).toHaveBeenCalledWith({
        where: { id: 'key-1' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'api_key.deleted' }),
      );
    });

    it('throws NotFoundException rather than deleting when the key does not exist in this workspace', async () => {
      prisma.apiKey.findFirst.mockResolvedValue(null);

      await expect(
        service.remove('ws-1', 'missing', 'user-1', ctx),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.apiKey.delete).not.toHaveBeenCalled();
    });
  });
});
