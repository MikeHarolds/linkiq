import { GlobalRole, type ApiKeyPermission } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import { hashToken } from '../../common/utils/token';
import type { PrismaService } from '../prisma/prisma.service';

import { ApiKeysAuthService } from './api-keys-auth.service';
import { ApiKeyExpiredException } from './exceptions/api-key-expired.exception';
import { ApiKeyRevokedException } from './exceptions/api-key-revoked.exception';
import { InvalidApiKeyException } from './exceptions/invalid-api-key.exception';

const RAW_KEY = 'lk_live_abcdefghijklmnopqrstuvwxyz012345';

function makeApiKeyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'key-1',
    workspaceId: 'ws-1',
    name: 'Production Website',
    keyPrefix: 'lk_live_abcdefgh',
    keyHash: hashToken(RAW_KEY),
    permissions: ['LINKS_READ'] as ApiKeyPermission[],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    createdById: 'user-1',
    createdBy: {
      id: 'user-1',
      email: 'dev@example.com',
      firstName: 'Dev',
      lastName: 'User',
      globalRole: GlobalRole.USER,
      isActive: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('ApiKeysAuthService', () => {
  let prisma: MockPrismaService;
  let service: ApiKeysAuthService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    prisma.apiKey.update.mockResolvedValue(undefined);
    service = new ApiKeysAuthService(prisma as unknown as PrismaService);
  });

  it('authenticates a valid key and resolves both the real user and the api-key context', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(makeApiKeyRow());

    const result = await service.authenticate(RAW_KEY);

    expect(result.user).toEqual({
      id: 'user-1',
      email: 'dev@example.com',
      firstName: 'Dev',
      lastName: 'User',
      globalRole: GlobalRole.USER,
      platformRoleId: undefined,
      platformPermissions: [],
      preferredCurrencyCode: null,
    });
    expect(result.apiKeyAuth).toEqual({
      authenticationType: 'api_key',
      apiKeyId: 'key-1',
      workspaceId: 'ws-1',
      createdById: 'user-1',
      permissions: ['LINKS_READ'],
    });
  });

  it('looks up the key by its hash, never the raw value', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(makeApiKeyRow());

    await service.authenticate(RAW_KEY);

    expect(prisma.apiKey.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { keyHash: hashToken(RAW_KEY) } }),
    );
  });

  it('rejects an unrecognized key with InvalidApiKeyException', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(null);

    await expect(service.authenticate('lk_live_doesnotexist')).rejects.toThrow(
      InvalidApiKeyException,
    );
  });

  it('rejects a revoked key with ApiKeyRevokedException', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(
      makeApiKeyRow({ revokedAt: new Date() }),
    );

    await expect(service.authenticate(RAW_KEY)).rejects.toThrow(
      ApiKeyRevokedException,
    );
  });

  it('rejects an expired key with ApiKeyExpiredException', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(
      makeApiKeyRow({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(service.authenticate(RAW_KEY)).rejects.toThrow(
      ApiKeyExpiredException,
    );
  });

  it('accepts a key whose expiresAt is still in the future', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(
      makeApiKeyRow({ expiresAt: new Date(Date.now() + 86_400_000) }),
    );

    await expect(service.authenticate(RAW_KEY)).resolves.toBeDefined();
  });

  it('rejects when the creating user no longer exists', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(
      makeApiKeyRow({ createdById: null, createdBy: null }),
    );

    await expect(service.authenticate(RAW_KEY)).rejects.toThrow(
      InvalidApiKeyException,
    );
  });

  it('rejects when the creating user has been deactivated', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(
      makeApiKeyRow({
        createdBy: {
          id: 'user-1',
          email: 'dev@example.com',
          firstName: 'Dev',
          lastName: 'User',
          globalRole: GlobalRole.USER,
          isActive: false,
        },
      }),
    );

    await expect(service.authenticate(RAW_KEY)).rejects.toThrow(
      InvalidApiKeyException,
    );
  });

  it('updates lastUsedAt without blocking authentication on the write', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(makeApiKeyRow());
    prisma.apiKey.update.mockRejectedValue(
      new Error('transient write failure'),
    );

    await expect(service.authenticate(RAW_KEY)).resolves.toBeDefined();
  });
});
