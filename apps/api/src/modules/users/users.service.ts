import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Currency, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import { CurrencyService } from '../currency/currency.service';
import { PrismaService } from '../prisma/prisma.service';

import type { ChangePasswordDto } from './dto/change-password.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly currencies: CurrencyService,
  ) {}

  private get bcryptRounds(): number {
    return this.config.get<number>('auth.bcryptSaltRounds') ?? 12;
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    ctx: RequestContext,
  ): Promise<User> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.firstName !== undefined && { firstName: dto.firstName.trim() }),
        ...(dto.lastName !== undefined && { lastName: dto.lastName.trim() }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
      },
    });

    await this.audit.record({
      action: 'user.profile_updated',
      entity: 'User',
      entityId: userId,
      userId,
      metadata: { fields: Object.keys(dto) },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return user;
  }

  /**
   * Verifies the current password before allowing a change, then revokes
   * every active session (including the one making this request) so the
   * new password is required everywhere going forward.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    const currentPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!currentPasswordValid) {
      await this.audit.record({
        action: 'user.password_change_failed',
        entity: 'User',
        entityId: userId,
        userId,
        metadata: { reason: 'invalid_current_password' },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, this.bcryptRounds);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.record({
      action: 'user.password_changed',
      entity: 'User',
      entityId: userId,
      userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  /**
   * Sprint 16 §7 — an authenticated user's explicit, persisted currency
   * choice. This is the ONLY thing that ever writes
   * User.preferredCurrencyId — CurrencyResolutionService only ever
   * reads it, never sets it (see that service's own docs on why IP
   * detection must never silently override an explicit choice).
   */
  async setCurrencyPreference(
    userId: string,
    currencyCode: string,
    ctx: RequestContext,
  ): Promise<Currency> {
    const currency = await this.currencies.getByCodeOrThrow(currencyCode);
    if (!currency.isActive) {
      throw new BadRequestException(`Currency "${currencyCode}" is not currently available`);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { preferredCurrencyId: currency.id },
    });

    await this.audit.record({
      action: 'user.currency_preference_set',
      entity: 'User',
      entityId: userId,
      userId,
      metadata: { currencyCode: currency.code },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return currency;
  }

  async clearCurrencyPreference(userId: string, ctx: RequestContext): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { preferredCurrencyId: null },
    });

    await this.audit.record({
      action: 'user.currency_preference_cleared',
      entity: 'User',
      entityId: userId,
      userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }
}
