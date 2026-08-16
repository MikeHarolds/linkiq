import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Ctx, type RequestContext } from '../../../common/decorators/request-context.decorator';
import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { BrandingService } from '../../branding/branding.service';
import { UpdateBrandingDto } from '../../branding/dto/update-branding.dto';
import { MAX_LOGO_BYTES, type UploadedFileLike } from '../../branding/upload-validation';

/**
 * Site Branding admin surface (Sprint 14) — SUPER_ADMIN only. Logo/
 * favicon bytes never pass through anywhere but this controller and
 * BrandingService/the storage provider — never logged, never included
 * in an audit metadata payload (only the original filename + size
 * are, both harmless). The public counterpart is PublicController's
 * GET /public/site-config, which exposes only siteName/logoUrl/
 * faviconUrl — never anything else from this module.
 */
@ApiTags('admin-branding')
@ApiBearerAuth()
@Controller('admin/branding')
@UseGuards(SuperAdminGuard)
export class AdminBrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get()
  @ApiOperation({ summary: 'Current site branding' })
  async get() {
    return this.branding.get();
  }

  @Patch()
  @ApiOperation({ summary: 'Update the site name' })
  async update(
    @Body() dto: UpdateBrandingDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.branding.updateSiteName(dto, admin.id, ctx);
  }

  @Post('logo')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload (or replace) the site logo' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES } }))
  async uploadLogo(
    @UploadedFile() file: UploadedFileLike,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.branding.uploadLogo(file, admin.id, ctx);
  }

  @Delete('logo')
  @ApiOperation({ summary: 'Remove the custom logo — falls back to the default LinkIQ mark' })
  async removeLogo(@CurrentUser() admin: AuthenticatedUser, @Ctx() ctx: RequestContext) {
    return this.branding.removeLogo(admin.id, ctx);
  }

  @Post('favicon')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload (or replace) the site favicon' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES } }))
  async uploadFavicon(
    @UploadedFile() file: UploadedFileLike,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.branding.uploadFavicon(file, admin.id, ctx);
  }

  @Delete('favicon')
  @ApiOperation({ summary: 'Remove the custom favicon' })
  async removeFavicon(@CurrentUser() admin: AuthenticatedUser, @Ctx() ctx: RequestContext) {
    return this.branding.removeFavicon(admin.id, ctx);
  }
}
