import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { ApiKeyAwareThrottlerGuard } from '../../common/guards/api-key-aware-throttler.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { BillingModule } from '../billing/billing.module';
import { EmailModule } from '../email/email.module';
import { RolesModule } from '../roles/roles.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { JwtStrategy } from './strategies/jwt.strategy';

const disableRateLimitForTests =
  process.env.DISABLE_RATE_LIMIT_FOR_TESTS === 'true';

@Module({
  imports: [
    PassportModule,
    BillingModule,
    RolesModule,
    EmailModule,
    // JwtAuthGuard's API-key branch needs ApiKeysAuthService — see
    // common/guards/jwt-auth.guard.ts.
    ApiKeysModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('auth.jwt.accessSecret'),
        signOptions: {
          expiresIn: config.get<string>('auth.jwt.accessExpiresIn'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    EmailVerificationService,
    JwtStrategy,
    // Applied globally: every route requires authentication unless
    // decorated with @Public(). See common/guards/jwt-auth.guard.ts.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Registered here, immediately after JwtAuthGuard in the same
    // providers array, so it reliably executes AFTER authentication —
    // multiple APP_GUARD providers run in the order Nest instantiates
    // them, and ApiKeyAwareThrottlerGuard's tracker/exception-shape logic
    // depends on request.apiKeyAuth already being set by JwtAuthGuard
    // (see that guard's docs). Registering it in app.module.ts instead
    // left the relative order unspecified and, empirically, wrong.
    // ThrottlerModule is @Global(), so this guard's own dependencies
    // (ThrottlerModuleOptions/ThrottlerStorage) still resolve fine here
    // even though this module never imports ThrottlerModule directly.
    ...(disableRateLimitForTests
      ? []
      : [{ provide: APP_GUARD, useClass: ApiKeyAwareThrottlerGuard }]),
  ],
  exports: [AuthService],
})
export class AuthModule {}
