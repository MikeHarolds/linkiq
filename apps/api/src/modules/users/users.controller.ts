import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PermissionKey } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  Ctx,
  type RequestContext,
} from '../../common/decorators/request-context.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type';
import { RequirePermission } from '../roles/decorators/require-permission.decorator';
import { PlatformPermissionsGuard } from '../roles/guards/platform-permissions.guard';
import { RoleResolutionService } from '../roles/role-resolution.service';

import { ChangePasswordDto } from './dto/change-password.dto';
import { SetCurrencyPreferenceDto } from './dto/set-currency-preference.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly roleResolution: RoleResolutionService,
  ) {}

  @Get('me/entitlement')
  @ApiOperation({
    summary:
      "The authenticated user's current platform role, why they have it, and what it grants — resolved live, not read from the access token (see docs/architecture/roles-and-permissions.md).",
  })
  async getMyEntitlement(@CurrentUser() user: AuthenticatedUser) {
    const resolved = await this.roleResolution.resolveEffectiveRole(user.id);
    return {
      role: resolved.roleSlug,
      source: resolved.source,
      permissions: user.platformPermissions,
    };
  }

  @Get('me/features/advanced-analytics')
  @UseGuards(PlatformPermissionsGuard)
  @RequirePermission(PermissionKey.ANALYTICS_ADVANCED)
  @ApiOperation({
    summary:
      'Demonstration endpoint proving @RequirePermission/PlatformPermissionsGuard end-to-end — gated by the ANALYTICS_ADVANCED platform permission, distinct from workspace-level authorization.',
  })
  getAdvancedAnalyticsPreview() {
    return { available: true };
  }

  @Patch('me')
  @ApiOperation({ summary: "Update the authenticated user's profile" })
  @ApiResponse({ status: 200, description: 'Profile updated' })
  @ApiResponse({ status: 401, description: 'Unauthenticated' })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
    @Ctx() ctx: RequestContext,
  ) {
    const updated = await this.usersService.updateProfile(user.id, dto, ctx);
    return {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      avatarUrl: updated.avatarUrl,
    };
  }

  @Get('me/currency-preference')
  @ApiOperation({ summary: "The authenticated user's persisted currency preference, if any" })
  async getCurrencyPreference(@CurrentUser() user: AuthenticatedUser) {
    return { currencyCode: user.preferredCurrencyCode ?? null };
  }

  @Patch('me/currency-preference')
  @ApiOperation({
    summary: "Set the authenticated user's preferred currency — overrides IP-based detection",
  })
  async setCurrencyPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetCurrencyPreferenceDto,
    @Ctx() ctx: RequestContext,
  ) {
    return this.usersService.setCurrencyPreference(user.id, dto.currency, ctx);
  }

  @Delete('me/currency-preference')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Clear the currency preference — falls back to IP detection / the platform default again',
  })
  async clearCurrencyPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.usersService.clearCurrencyPreference(user.id, ctx);
  }

  @Post('me/change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Change the authenticated user's password",
    description:
      'Requires the current password. Revokes every active session on success — the caller must log in again.',
  })
  @ApiResponse({ status: 204, description: 'Password changed' })
  @ApiResponse({
    status: 401,
    description: 'Current password incorrect, or unauthenticated',
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Ctx() ctx: RequestContext,
  ): Promise<void> {
    await this.usersService.changePassword(user.id, dto, ctx);
  }
}
