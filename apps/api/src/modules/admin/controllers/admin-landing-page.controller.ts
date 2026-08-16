import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LandingPageSectionKey } from '@prisma/client';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Ctx, type RequestContext } from '../../../common/decorators/request-context.decorator';
import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { CreateLandingPageFaqDto } from '../../landing-page/dto/create-faq.dto';
import { CreateLandingPageFeatureDto } from '../../landing-page/dto/create-feature.dto';
import { CreateLandingPageNavItemDto } from '../../landing-page/dto/create-nav-item.dto';
import { CreateLandingPageStatDto } from '../../landing-page/dto/create-stat.dto';
import { ReorderDto } from '../../landing-page/dto/reorder.dto';
import { UpdateLandingPageFaqDto } from '../../landing-page/dto/update-faq.dto';
import { UpdateLandingPageFeatureDto } from '../../landing-page/dto/update-feature.dto';
import { UpdateLandingPageNavItemDto } from '../../landing-page/dto/update-nav-item.dto';
import { UpdateLandingPageSectionDto } from '../../landing-page/dto/update-section.dto';
import { UpdateLandingPageStatDto } from '../../landing-page/dto/update-stat.dto';
import { LandingPageService } from '../../landing-page/landing-page.service';

/**
 * Landing Page CMS admin surface (Sprint 14) — SUPER_ADMIN only. Full
 * read/write over every section and every repeatable content type;
 * the public, read-only, active-content-only counterpart is
 * PublicController's GET /public/landing-page. Every mutation is
 * audited by LandingPageService itself, not duplicated here.
 */
@ApiTags('admin-landing-page')
@ApiBearerAuth()
@Controller('admin/landing-page')
@UseGuards(SuperAdminGuard)
export class AdminLandingPageController {
  constructor(private readonly landingPage: LandingPageService) {}

  @Get()
  @ApiOperation({ summary: 'Every section + repeatable content item, including inactive ones' })
  async getAll() {
    return this.landingPage.getAdminContent();
  }

  @Patch('sections/:key')
  @ApiOperation({ summary: 'Update one landing-page section' })
  async updateSection(
    @Param('key') key: LandingPageSectionKey,
    @Body() dto: UpdateLandingPageSectionDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.landingPage.updateSection(key, dto, admin.id, ctx);
  }

  @Post('features')
  @ApiOperation({ summary: 'Create a feature card' })
  async createFeature(
    @Body() dto: CreateLandingPageFeatureDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.landingPage.createFeature(dto, admin.id, ctx);
  }

  @Patch('features/:id')
  @ApiOperation({ summary: 'Update a feature card' })
  async updateFeature(
    @Param('id') id: string,
    @Body() dto: UpdateLandingPageFeatureDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.landingPage.updateFeature(id, dto, admin.id, ctx);
  }

  @Delete('features/:id')
  @ApiOperation({ summary: 'Delete a feature card' })
  async deleteFeature(@Param('id') id: string, @CurrentUser() admin: AuthenticatedUser, @Ctx() ctx: RequestContext) {
    await this.landingPage.deleteFeature(id, admin.id, ctx);
    return { success: true };
  }

  @Post('features/reorder')
  @ApiOperation({ summary: 'Reorder feature cards' })
  async reorderFeatures(@Body() dto: ReorderDto, @CurrentUser() admin: AuthenticatedUser, @Ctx() ctx: RequestContext) {
    await this.landingPage.reorderFeatures(dto.orderedIds, admin.id, ctx);
    return { success: true };
  }

  @Post('faqs')
  @ApiOperation({ summary: 'Create an FAQ entry' })
  async createFaq(
    @Body() dto: CreateLandingPageFaqDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.landingPage.createFaq(dto, admin.id, ctx);
  }

  @Patch('faqs/:id')
  @ApiOperation({ summary: 'Update an FAQ entry' })
  async updateFaq(
    @Param('id') id: string,
    @Body() dto: UpdateLandingPageFaqDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.landingPage.updateFaq(id, dto, admin.id, ctx);
  }

  @Delete('faqs/:id')
  @ApiOperation({ summary: 'Delete an FAQ entry' })
  async deleteFaq(@Param('id') id: string, @CurrentUser() admin: AuthenticatedUser, @Ctx() ctx: RequestContext) {
    await this.landingPage.deleteFaq(id, admin.id, ctx);
    return { success: true };
  }

  @Post('faqs/reorder')
  @ApiOperation({ summary: 'Reorder FAQ entries' })
  async reorderFaqs(@Body() dto: ReorderDto, @CurrentUser() admin: AuthenticatedUser, @Ctx() ctx: RequestContext) {
    await this.landingPage.reorderFaqs(dto.orderedIds, admin.id, ctx);
    return { success: true };
  }

  @Post('stats')
  @ApiOperation({ summary: 'Create a capability-strip stat' })
  async createStat(
    @Body() dto: CreateLandingPageStatDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.landingPage.createStat(dto, admin.id, ctx);
  }

  @Patch('stats/:id')
  @ApiOperation({ summary: 'Update a capability-strip stat' })
  async updateStat(
    @Param('id') id: string,
    @Body() dto: UpdateLandingPageStatDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.landingPage.updateStat(id, dto, admin.id, ctx);
  }

  @Delete('stats/:id')
  @ApiOperation({ summary: 'Delete a capability-strip stat' })
  async deleteStat(@Param('id') id: string, @CurrentUser() admin: AuthenticatedUser, @Ctx() ctx: RequestContext) {
    await this.landingPage.deleteStat(id, admin.id, ctx);
    return { success: true };
  }

  @Post('stats/reorder')
  @ApiOperation({ summary: 'Reorder capability-strip stats' })
  async reorderStats(@Body() dto: ReorderDto, @CurrentUser() admin: AuthenticatedUser, @Ctx() ctx: RequestContext) {
    await this.landingPage.reorderStats(dto.orderedIds, admin.id, ctx);
    return { success: true };
  }

  @Post('nav-items')
  @ApiOperation({ summary: 'Create a header/footer navigation link' })
  async createNavItem(
    @Body() dto: CreateLandingPageNavItemDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.landingPage.createNavItem(dto, admin.id, ctx);
  }

  @Patch('nav-items/:id')
  @ApiOperation({ summary: 'Update a navigation link' })
  async updateNavItem(
    @Param('id') id: string,
    @Body() dto: UpdateLandingPageNavItemDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.landingPage.updateNavItem(id, dto, admin.id, ctx);
  }

  @Delete('nav-items/:id')
  @ApiOperation({ summary: 'Delete a navigation link' })
  async deleteNavItem(@Param('id') id: string, @CurrentUser() admin: AuthenticatedUser, @Ctx() ctx: RequestContext) {
    await this.landingPage.deleteNavItem(id, admin.id, ctx);
    return { success: true };
  }

  @Post('nav-items/reorder')
  @ApiOperation({ summary: 'Reorder navigation links within one placement' })
  async reorderNavItems(@Body() dto: ReorderDto, @CurrentUser() admin: AuthenticatedUser, @Ctx() ctx: RequestContext) {
    await this.landingPage.reorderNavItems(dto.orderedIds, admin.id, ctx);
    return { success: true };
  }
}
