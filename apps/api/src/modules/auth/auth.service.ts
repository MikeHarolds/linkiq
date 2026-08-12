import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { GlobalRole, WorkspaceRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { uniqueSlug } from '../../common/utils/slugify';
import { generateOpaqueToken, hashToken } from '../../common/utils/token';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from '../billing/subscriptions.service';
import { PrismaService } from '../prisma/prisma.service';

import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type {
  AccessTokenPayload,
  AuthenticatedUser,
} from './types/authenticated-user.type';

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshTokenId: string;
  refreshTokenExpiresAt: Date;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

const GENERIC_LOGIN_ERROR = 'Invalid email or password';
const GENERIC_RESET_ERROR = 'Invalid or expired password reset token';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  private get bcryptRounds(): number {
    return this.config.get<number>('auth.bcryptSaltRounds') ?? 12;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  toAuthenticatedUser(user: User): AuthenticatedUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      globalRole: user.globalRole,
    };
  }

  // ---------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------

  async register(
    dto: RegisterDto,
    ctx: RequestContext,
  ): Promise<{
    user: User;
    workspaces: WorkspaceSummary[];
    session: IssuedSession;
  }> {
    const email = this.normalizeEmail(dto.email);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);

    const { user, workspace } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          globalRole: GlobalRole.USER,
          emailVerified: false,
        },
      });

      const organizationName = `${user.firstName}'s Organization`;
      const organization = await tx.organization.create({
        data: {
          name: organizationName,
          slug: uniqueSlug(organizationName),
          ownerId: user.id,
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: 'Main Workspace',
          slug: 'main',
          organizationId: organization.id,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: WorkspaceRole.OWNER,
        },
      });

      // Same transaction as the workspace itself — a workspace can never
      // exist without a subscription, even under a crash mid-request.
      await this.subscriptions.createDefaultSubscription(tx, workspace.id);

      return { user, workspace };
    });

    await this.audit.record({
      action: 'user.registered',
      entity: 'User',
      entityId: user.id,
      userId: user.id,
      workspaceId: workspace.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const session = await this.issueSession(user, ctx);

    return {
      user,
      workspaces: [
        {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          role: WorkspaceRole.OWNER,
        },
      ],
      session,
    };
  }

  // ---------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------

  async login(
    dto: LoginDto,
    ctx: RequestContext,
  ): Promise<{
    user: User;
    workspaces: WorkspaceSummary[];
    session: IssuedSession;
  }> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Constant-shape failure path: whether the email doesn't exist, the
    // account is deactivated, or the password is wrong, the caller sees
    // exactly the same error — this is what prevents user enumeration.
    if (!user || !user.isActive) {
      await this.audit.record({
        action: 'auth.login_failed',
        entity: 'User',
        entityId: user?.id,
        userId: user?.id,
        metadata: { email, reason: user ? 'inactive_account' : 'no_such_user' },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      await this.audit.record({
        action: 'auth.login_failed',
        entity: 'User',
        entityId: user.id,
        userId: user.id,
        metadata: { email, reason: 'invalid_password' },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    await this.audit.record({
      action: 'auth.login_succeeded',
      entity: 'User',
      entityId: user.id,
      userId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const [workspaces, session] = await Promise.all([
      this.listWorkspacesForUser(user.id),
      this.issueSession(user, ctx),
    ]);

    return { user, workspaces, session };
  }

  // ---------------------------------------------------------------------
  // Session issuance / refresh / logout
  // ---------------------------------------------------------------------

  private signAccessToken(user: User): string {
    const payload: AccessTokenPayload = { sub: user.id, email: user.email };
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('auth.jwt.accessSecret'),
      expiresIn: this.config.get<string>('auth.jwt.accessExpiresIn'),
    });
  }

  private async issueSession(
    user: User,
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    const accessToken = this.signAccessToken(user);

    const refreshToken = generateOpaqueToken();
    const refreshDays =
      this.config.get<number>('auth.jwt.refreshExpiresInDays') ?? 7;
    const refreshTokenExpiresAt = new Date(
      Date.now() + refreshDays * 24 * 60 * 60 * 1000,
    );

    const created = await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        userAgent: ctx.userAgent,
        ipAddress: ctx.ipAddress,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      refreshTokenId: created.id,
      refreshTokenExpiresAt,
    };
  }

  /**
   * Validates and rotates a refresh token. Rotation means: the presented
   * token is revoked and a brand new one is issued and returned — the old
   * value stops working immediately. If a token that's already been
   * revoked is presented again (a strong signal of token theft, since
   * legitimate clients always use their latest token), every session for
   * that user is revoked as a containment measure.
   */
  async refresh(
    rawToken: string,
    ctx: RequestContext,
  ): Promise<{ user: User; session: IssuedSession }> {
    const tokenHash = hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid session');
    }

    if (existing.revokedAt) {
      this.logger.warn(
        `Reused revoked refresh token detected for user ${existing.userId} — revoking all sessions`,
      );
      await this.revokeAllSessions(existing.userId);
      await this.audit.record({
        action: 'auth.session_reuse_detected',
        entity: 'User',
        entityId: existing.userId,
        userId: existing.userId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedException('Invalid session');
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expired');
    }

    if (!existing.user.isActive) {
      throw new UnauthorizedException('Invalid session');
    }

    const session = await this.issueSession(existing.user, ctx);

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: {
        revokedAt: new Date(),
        replacedBy: session.refreshTokenId,
      },
    });

    return { user: existing.user, session };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      return;
    }
    const tokenHash = hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string, ctx: RequestContext): Promise<void> {
    await this.revokeAllSessions(userId);
    await this.audit.record({
      action: 'auth.logout_all',
      entity: 'User',
      entityId: userId,
      userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async findByIdOrThrow(userId: string): Promise<User> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return user;
  }

  // ---------------------------------------------------------------------
  // Current user / workspace listing
  // ---------------------------------------------------------------------

  async listWorkspacesForUser(userId: string): Promise<WorkspaceSummary[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: m.role,
    }));
  }

  // ---------------------------------------------------------------------
  // Password recovery
  // ---------------------------------------------------------------------

  /**
   * Always resolves successfully regardless of whether the email exists —
   * callers must not be able to distinguish "email sent" from "no such
   * account" (that distinction is exactly what enables account enumeration).
   */
  async forgotPassword(email: string, ctx: RequestContext): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user || !user.isActive) {
      return;
    }

    const rawToken = generateOpaqueToken();
    const expiresInMinutes =
      this.config.get<number>('auth.passwordReset.tokenExpiresInMinutes') ?? 30;

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
      },
    });

    await this.audit.record({
      action: 'auth.password_reset_requested',
      entity: 'User',
      entityId: user.id,
      userId: user.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    this.sendPasswordResetEmail(user.email, rawToken);
  }

  async resetPassword(
    rawToken: string,
    newPassword: string,
    ctx: RequestContext,
  ): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (
      !resetToken ||
      resetToken.usedAt ||
      resetToken.expiresAt.getTime() < Date.now()
    ) {
      throw new UnauthorizedException(GENERIC_RESET_ERROR);
    }

    const passwordHash = await bcrypt.hash(newPassword, this.bcryptRounds);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    // A password reset is a strong signal to invalidate every existing
    // session — if the reset was triggered because credentials leaked,
    // any already-issued session should not survive it.
    await this.revokeAllSessions(resetToken.userId);

    await this.audit.record({
      action: 'auth.password_reset_completed',
      entity: 'User',
      entityId: resetToken.userId,
      userId: resetToken.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /**
   * Development-mode "email" delivery: logs a clearly marked message with
   * the reset link instead of sending a real email. Swap this method's
   * implementation for a real provider (SES, Postmark, Resend, ...) when
   * the platform integrates one — no other code in this service changes.
   */
  private sendPasswordResetEmail(email: string, rawToken: string): void {
    const appUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const resetLink = `${appUrl}/reset-password?token=${rawToken}`;

    if (process.env.NODE_ENV === 'production') {
      this.logger.warn(
        `No email provider configured — password reset link for ${email} was not delivered.`,
      );
      return;
    }

    // eslint-disable-next-line no-console
    console.log(
      `\n[DEV EMAIL] Password reset requested for ${email}\n[DEV EMAIL] Reset link: ${resetLink}\n[DEV EMAIL] This link is only logged in non-production environments.\n`,
    );
  }
}
