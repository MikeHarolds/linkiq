import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  Ctx,
  type RequestContext,
} from '../../common/decorators/request-context.decorator';

import { AuthService } from './auth.service';
import { AuthResponseDto, MeResponseDto } from './dto/auth-response.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import type { AuthenticatedUser } from './types/authenticated-user.type';
import { setRefreshCookie, clearRefreshCookie } from './utils/refresh-cookie';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new account',
    description:
      'Creates a user, their initial workspace (as OWNER), and an authenticated session. Rate-limited to 5 requests/minute per client.',
  })
  @ApiResponse({
    status: 201,
    description: 'Account created',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(
    @Body() dto: RegisterDto,
    // true: this endpoint is always reached via the web app's own
    // rewrite proxy in a split-hostname deployment — see Ctx's own
    // doc comment.
    @Ctx(true) ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const { user, workspaces, session } = await this.authService.register(
      dto,
      ctx,
    );
    setRefreshCookie(
      res,
      this.config,
      session.refreshToken,
      session.refreshTokenExpiresAt,
    );

    return {
      accessToken: session.accessToken,
      user: toUserProfile(user),
      workspaces,
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticate with email and password',
    description:
      'Returns an access token plus sets an httpOnly refresh-token cookie. Rate-limited to 5 requests/minute per client to slow credential stuffing.',
  })
  @ApiResponse({
    status: 200,
    description: 'Authenticated',
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  async login(
    @Body() dto: LoginDto,
    // See register()'s @Ctx(true) comment above.
    @Ctx(true) ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const { user, workspaces, session } = await this.authService.login(
      dto,
      ctx,
    );
    setRefreshCookie(
      res,
      this.config,
      session.refreshToken,
      session.refreshTokenExpiresAt,
    );

    return {
      accessToken: session.accessToken,
      user: toUserProfile(user),
      workspaces,
    };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a valid refresh-token cookie for a new access token',
    description:
      'Rotates the refresh token: the previous one is revoked and a new one is set. Reusing an already-rotated token revokes all sessions for that user as a theft-containment measure.',
  })
  @ApiResponse({
    status: 200,
    description: 'New access token issued',
    type: AuthResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing, invalid, or expired session',
  })
  async refresh(
    @Req() req: Request,
    // See register()'s @Ctx(true) comment above.
    @Ctx(true) ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const cookieName = this.config.get<string>('auth.cookie.name')!;
    const rawToken = (req.cookies as Record<string, string> | undefined)?.[
      cookieName
    ];

    if (!rawToken) {
      throw new UnauthorizedException('No active session');
    }

    const { user, session } = await this.authService.refresh(rawToken, ctx);
    setRefreshCookie(
      res,
      this.config,
      session.refreshToken,
      session.refreshTokenExpiresAt,
    );

    const workspaces = await this.authService.listWorkspacesForUser(user.id);

    return {
      accessToken: session.accessToken,
      user: toUserProfile(user),
      workspaces,
    };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Log out of the current session',
    description:
      'Revokes the refresh token in the request cookie and clears it. Idempotent — succeeds even if there is no active session.',
  })
  @ApiResponse({ status: 204, description: 'Logged out' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const cookieName = this.config.get<string>('auth.cookie.name')!;
    const rawToken = (req.cookies as Record<string, string> | undefined)?.[
      cookieName
    ];
    await this.authService.logout(rawToken);
    clearRefreshCookie(res, this.config);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Log out of every active session for the current user',
    description: 'Revokes every refresh token belonging to the caller.',
  })
  @ApiResponse({ status: 204, description: 'All sessions revoked' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logoutAll(user.id, ctx);
    clearRefreshCookie(res, this.config);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get the authenticated user's profile and workspace memberships",
  })
  @ApiResponse({
    status: 200,
    description: 'Current user',
    type: MeResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    const [freshUser, workspaces] = await Promise.all([
      this.authService.findByIdOrThrow(user.id),
      this.authService.listWorkspacesForUser(user.id),
    ]);

    return { user: toUserProfile(freshUser), workspaces };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password reset link',
    description:
      'Always returns the same generic response whether or not the email is registered, to prevent account enumeration. Rate-limited to 3 requests/minute per client.',
  })
  @ApiResponse({
    status: 200,
    description: 'Request accepted (generic response)',
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Ctx() ctx: RequestContext,
  ): Promise<{ message: string }> {
    await this.authService.forgotPassword(dto.email, ctx);
    return {
      message:
        'If an account with that email exists, a password reset link has been sent.',
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset a password using a valid reset token',
    description:
      'Consumes the token (single use) and revokes every existing session for the account.',
  })
  @ApiResponse({ status: 200, description: 'Password reset' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Ctx() ctx: RequestContext,
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(dto.token, dto.password, ctx);
    return { message: 'Password reset successfully. Please log in again.' };
  }
}

function toUserProfile(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  globalRole: string;
  emailVerified: boolean;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    globalRole: user.globalRole,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  };
}
