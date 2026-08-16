import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { GlobalRole, WorkspaceRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { AuditService } from '../audit/audit.service';
import type { SubscriptionsService } from '../billing/subscriptions.service';
import type { RoleResolutionService } from '../roles/role-resolution.service';

import { AuthService } from './auth.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

const OWNER = 'OWNER' as WorkspaceRole;
const USER_ROLE = 'USER' as GlobalRole;
const CTX = { ipAddress: '127.0.0.1', userAgent: 'jest' };

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    passwordHash: '$2b$12$abcdefghijklmnopqrstuv', // placeholder, overridden per-test where needed
    firstName: 'Jane',
    lastName: 'Doe',
    avatarUrl: null,
    globalRole: USER_ROLE,
    isActive: true,
    emailVerified: false,
    platformRoleId: null,
    roleAssignmentSource: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('AuthService', () => {
  let prisma: MockPrismaService;
  let jwt: { sign: jest.Mock };
  let config: { get: jest.Mock };
  let audit: { record: jest.Mock };
  let subscriptions: { createDefaultSubscription: jest.Mock };
  let roleResolution: { syncStoredRole: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    jwt = { sign: jest.fn().mockReturnValue('signed.access.token') };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    subscriptions = {
      createDefaultSubscription: jest.fn().mockResolvedValue(undefined),
    };
    roleResolution = { syncStoredRole: jest.fn().mockResolvedValue(undefined) };

    const configValues: Record<string, unknown> = {
      'auth.bcryptSaltRounds': 4, // low rounds keep unit tests fast
      'auth.jwt.accessSecret': 'test-secret',
      'auth.jwt.accessExpiresIn': '15m',
      'auth.jwt.refreshExpiresInDays': 7,
      'auth.passwordReset.tokenExpiresInMinutes': 30,
    };
    config = { get: jest.fn((key: string) => configValues[key]) };

    service = new AuthService(
      prisma as unknown as never,
      jwt as unknown as JwtService,
      config as unknown as ConfigService,
      audit as unknown as AuditService,
      subscriptions as unknown as SubscriptionsService,
      roleResolution as unknown as RoleResolutionService,
    );
  });

  describe('register', () => {
    const dto: RegisterDto = {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'Jane@Example.com', // deliberately mixed case
      password: 'SecurePass123',
      passwordConfirmation: 'SecurePass123',
      termsAccepted: true,
    };

    it('rejects registration when the email is already taken', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());

      await expect(service.register(dto, CTX)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('normalizes the email to lowercase before checking/creating', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const created = makeUser({ email: 'jane@example.com' });
      prisma.user.create.mockResolvedValue(created);
      prisma.organization.create.mockResolvedValue({ id: 'org-1' });
      prisma.workspace.create.mockResolvedValue({
        id: 'ws-1',
        name: 'Main Workspace',
        slug: 'main',
      });
      prisma.workspaceMember.create.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      await service.register(dto, CTX);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'jane@example.com' },
      });
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'jane@example.com' }),
        }),
      );
    });

    it('stores a bcrypt hash, never the plaintext password', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(
        ({ data }: { data: { passwordHash: string } }) =>
          makeUser({ passwordHash: data.passwordHash }),
      );
      prisma.organization.create.mockResolvedValue({ id: 'org-1' });
      prisma.workspace.create.mockResolvedValue({
        id: 'ws-1',
        name: 'Main Workspace',
        slug: 'main',
      });
      prisma.workspaceMember.create.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      await service.register(dto, CTX);

      const createCall = prisma.user.create.mock.calls[0][0];
      expect(createCall.data.passwordHash).not.toBe(dto.password);
      expect(
        await bcrypt.compare(dto.password, createCall.data.passwordHash),
      ).toBe(true);
    });

    it('creates an organization, workspace, and OWNER membership, and records an audit event', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const created = makeUser();
      prisma.user.create.mockResolvedValue(created);
      prisma.organization.create.mockResolvedValue({ id: 'org-1' });
      const workspace = { id: 'ws-1', name: 'Main Workspace', slug: 'main' };
      prisma.workspace.create.mockResolvedValue(workspace);
      prisma.workspaceMember.create.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.register(dto, CTX);

      expect(prisma.workspaceMember.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: OWNER }),
        }),
      );
      expect(result.workspaces).toEqual([
        { id: 'ws-1', name: 'Main Workspace', slug: 'main', role: OWNER },
      ]);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.registered',
          userId: created.id,
        }),
      );
    });
  });

  describe('login', () => {
    const dto: LoginDto = {
      email: 'jane@example.com',
      password: 'SecurePass123',
    };

    it('rejects with a generic error when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(dto, CTX)).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );
    });

    it('rejects with the SAME generic error when the password is wrong (no enumeration)', async () => {
      const hash = await bcrypt.hash('CorrectPassword1', 4);
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash: hash }),
      );

      await expect(service.login(dto, CTX)).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );
    });

    it('rejects a deactivated account with the same generic error', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser({ isActive: false }));

      await expect(service.login(dto, CTX)).rejects.toThrow(
        new UnauthorizedException('Invalid email or password'),
      );
    });

    it('records a failed-login audit event without leaking whether the account exists in the thrown error', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(dto, CTX)).rejects.toThrow();

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login_failed' }),
      );
    });

    it('succeeds with correct credentials and issues a session', async () => {
      const hash = await bcrypt.hash(dto.password, 4);
      const user = makeUser({ passwordHash: hash });
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.workspaceMember.findMany.mockResolvedValue([]);
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.login(dto, CTX);

      expect(result.user).toBe(user);
      expect(result.session.accessToken).toBe('signed.access.token');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login_succeeded' }),
      );
    });
  });

  describe('refresh', () => {
    it('rejects when the token does not exist', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('nonexistent', CTX)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user: makeUser(),
      });

      await expect(service.refresh('expired', CTX)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('detects reuse of a revoked token and revokes every session for that user', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 1000),
        user: makeUser(),
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await expect(service.refresh('stolen-and-reused', CTX)).rejects.toThrow(
        UnauthorizedException,
      );

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', revokedAt: null },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.session_reuse_detected' }),
      );
    });

    it('rotates a valid token: revokes the old one and issues a new one', async () => {
      const user = makeUser();
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-old',
        userId: user.id,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 1000),
        user,
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-new' });
      prisma.refreshToken.update.mockResolvedValue({});

      const result = await service.refresh('valid-token', CTX);

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-old' },
        data: { revokedAt: expect.any(Date), replacedBy: 'rt-new' },
      });
      expect(result.session.accessToken).toBe('signed.access.token');
    });

    it('rejects when the underlying user is deactivated', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 1000),
        user: makeUser({ isActive: false }),
      });

      await expect(service.refresh('token', CTX)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout / logoutAll', () => {
    it('logout is a no-op when no token is presented (idempotent)', async () => {
      await service.logout(undefined);
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('logout revokes only the matching, currently-active token', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      await service.logout('some-raw-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ revokedAt: null }),
        }),
      );
    });

    it('logoutAll revokes every active session and records an audit event', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
      await service.logoutAll('user-1', CTX);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.logout_all' }),
      );
    });
  });

  describe('forgotPassword', () => {
    it('resolves successfully even when no account exists (no enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.forgotPassword('nobody@example.com', CTX),
      ).resolves.toBeUndefined();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('creates a reset token when the account exists and is active', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser());
      prisma.passwordResetToken.create.mockResolvedValue({});

      await service.forgotPassword('jane@example.com', CTX);

      expect(prisma.passwordResetToken.create).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.password_reset_requested' }),
      );
    });

    it('does not create a reset token for a deactivated account', async () => {
      prisma.user.findUnique.mockResolvedValue(makeUser({ isActive: false }));

      await service.forgotPassword('jane@example.com', CTX);

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('rejects an unknown token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword('bad-token', 'NewPass123', CTX),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an already-used token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 1000),
      });

      await expect(
        service.resetPassword('used-token', 'NewPass123', CTX),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.resetPassword('expired-token', 'NewPass123', CTX),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('on success: updates the password, marks the token used, and revokes all sessions', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: 'user-1',
        usedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 1000),
      });
      prisma.user.update.mockResolvedValue(makeUser());
      prisma.passwordResetToken.update.mockResolvedValue({});
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await service.resetPassword('valid-token', 'NewPass123', CTX);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' } }),
      );
      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'prt-1' },
        data: { usedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', revokedAt: null },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.password_reset_completed' }),
      );
    });
  });
});
