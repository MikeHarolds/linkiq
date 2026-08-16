import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { GlobalRole } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../test/mocks/prisma.mock';
import type { AccessTokenPayload } from '../types/authenticated-user.type';

import { JwtStrategy } from './jwt.strategy';

const USER_ROLE = 'USER' as GlobalRole;

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    globalRole: USER_ROLE,
    isActive: true,
    platformRoleId: null,
    platformRole: null,
    preferredCurrency: null,
    ...overrides,
  };
}

describe('JwtStrategy', () => {
  let prisma: MockPrismaService;
  let strategy: JwtStrategy;

  const payload: AccessTokenPayload = {
    sub: 'user-1',
    email: 'jane@example.com',
    globalRole: USER_ROLE,
  } as AccessTokenPayload;

  beforeEach(() => {
    prisma = createMockPrismaService();
    const config = { get: jest.fn().mockReturnValue('test-secret') } as unknown as ConfigService;
    strategy = new JwtStrategy(config, prisma as never);
  });

  it('resolves the authenticated user for an active account', async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser());

    const result = await strategy.validate(payload);

    expect(result).toEqual({
      id: 'user-1',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      globalRole: USER_ROLE,
      platformRoleId: null,
      platformPermissions: [],
      preferredCurrencyCode: null,
    });
  });

  it('resolves the joined currency code when a preference is set', async () => {
    prisma.user.findUnique.mockResolvedValue(
      makeUser({ preferredCurrency: { code: 'NGN' } }),
    );

    const result = await strategy.validate(payload);

    expect(result.preferredCurrencyCode).toBe('NGN');
  });

  it('includes the resolved platform permissions when the user has an active platform role', async () => {
    prisma.user.findUnique.mockResolvedValue(
      makeUser({
        platformRoleId: 'role-1',
        platformRole: {
          isActive: true,
          permissions: [{ permission: 'LINKS_VIEW' }, { permission: 'LINKS_CREATE' }],
        },
      }),
    );

    const result = await strategy.validate(payload);

    expect(result.platformRoleId).toBe('role-1');
    expect(result.platformPermissions).toEqual(['LINKS_VIEW', 'LINKS_CREATE']);
  });

  it('grants zero permissions when the assigned platform role is itself inactive', async () => {
    prisma.user.findUnique.mockResolvedValue(
      makeUser({
        platformRoleId: 'role-1',
        platformRole: { isActive: false, permissions: [{ permission: 'LINKS_VIEW' }] },
      }),
    );

    const result = await strategy.validate(payload);

    expect(result.platformPermissions).toEqual([]);
  });

  it('rejects a deactivated user even with a valid, unexpired access token', async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser({ isActive: false }));

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when the user no longer exists (deleted after token issuance)', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });

  it('performs a fresh per-request database lookup rather than trusting the token payload alone', async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser());

    await strategy.validate(payload);

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: payload.sub } }),
    );
  });
});
