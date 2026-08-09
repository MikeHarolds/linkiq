import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import type { ChangePasswordDto } from './dto/change-password.dto';
import type { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
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
}
