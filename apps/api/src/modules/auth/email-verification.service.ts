import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailLogType, type User } from '@prisma/client';

import { generateOpaqueToken, hashToken } from '../../common/utils/token';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';

const GENERIC_VERIFY_ERROR = 'Invalid or expired verification link';

/**
 * Email verification lifecycle — issue/verify/resend. Kept as its own
 * service (not folded into AuthService) so the existing, already-working
 * register/login/forgot-password/reset-password methods stay untouched
 * except for two small additive call sites (see AuthService.register and
 * .sendPasswordResetEmail). Same token shape/rationale as
 * PasswordResetToken: SHA-256 hash only, single-use (`usedAt`), expiring,
 * and never itself capable of issuing a session — verifying a token only
 * flips User.emailVerified.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  private get expiresInHours(): number {
    return (
      this.config.get<number>('auth.emailVerification.tokenExpiresInHours') ??
      24
    );
  }

  /** Returns the generated verificationUrl so a caller (e.g.
   * AuthService.register) can also embed it in a different email — e.g.
   * the welcome email's verification CTA — without issuing a second,
   * separate token for the same purpose. */
  async issueAndSend(user: User): Promise<string> {
    const rawToken = generateOpaqueToken();
    const appUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const verificationUrl = `${appUrl}/verify-email?token=${rawToken}`;

    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + this.expiresInHours * 60 * 60 * 1000),
      },
    });

    await this.emailService.queueEmail({
      to: user.email,
      type: EmailLogType.VERIFICATION,
      recipientUserId: user.id,
      templateVars: {
        firstName: user.firstName,
        verificationUrl,
        expiresInHours: this.expiresInHours,
      },
    });

    return verificationUrl;
  }

  /** Indistinguishable failure shape for expired/used/not-found — same
   * anti-enumeration posture AuthService.resetPassword already uses for
   * its own token validation. */
  async verify(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const token = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!token || token.usedAt || token.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException(GENERIC_VERIFY_ERROR);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { emailVerified: true },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
    ]);
  }

  /** Silently no-ops if the account is already verified or doesn't
   * exist — same "never let the caller distinguish states" principle
   * as AuthService.forgotPassword. Invalidates any prior unused token
   * before issuing a fresh one so only the latest link ever works. */
  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.emailVerified) {
      return;
    }

    await this.prisma.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.issueAndSend(user);
  }
}
