import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { PrismaService } from '../../prisma/prisma.service';
import type {
  AccessTokenPayload,
  AuthenticatedUser,
} from '../types/authenticated-user.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('auth.jwt.accessSecret'),
    });
  }

  /**
   * Runs after signature + expiry are verified. We still re-check the user
   * exists and is active on every request — a deactivated account's
   * already-issued access tokens stop working within one token lifetime
   * (≤15 min), not just at their next login.
   */
  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        globalRole: true,
        isActive: true,
        platformRoleId: true,
        // isActive on the join, not just the role row's own isActive —
        // an inactive PlatformRole must never keep granting permissions
        // just because a user was assigned it before it was deactivated
        // (see RoleResolutionService's docs on resolution vs. granting).
        platformRole: {
          select: { isActive: true, permissions: { select: { permission: true } } },
        },
        // Sprint 16 — the join, not just the stored id, so an
        // authenticated request can show the currency's code without a
        // second round trip; see AuthenticatedUser.preferredCurrencyCode.
        preferredCurrency: { select: { code: true } },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      globalRole: user.globalRole,
      platformRoleId: user.platformRoleId,
      platformPermissions:
        user.platformRole?.isActive ? user.platformRole.permissions.map((p) => p.permission) : [],
      preferredCurrencyCode: user.preferredCurrency?.code ?? null,
    };
  }
}
