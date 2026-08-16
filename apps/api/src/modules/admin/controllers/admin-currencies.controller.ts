import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Ctx, type RequestContext } from '../../../common/decorators/request-context.decorator';
import { SuperAdminGuard } from '../../../common/guards/super-admin.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { BILLING_PROVIDER, type BillingProvider } from '../../billing/providers/billing-provider.interface';
import { CurrencyService } from '../../currency/currency.service';
import { CreateCountryMappingDto } from '../../currency/dto/create-country-mapping.dto';
import { CreateCurrencyDto } from '../../currency/dto/create-currency.dto';
import { UpdateCountryMappingDto } from '../../currency/dto/update-country-mapping.dto';
import { UpdateCurrencySettingsDto } from '../../currency/dto/update-currency-settings.dto';
import { UpdateCurrencyDto } from '../../currency/dto/update-currency.dto';

/**
 * Super Admin currency catalogue, country mapping, and platform
 * settings (Sprint 16) — every mutation SuperAdminGuard-protected and
 * audited via CurrencyService (which itself uses the existing
 * AuditService, never a second audit mechanism). Static sub-paths
 * (`settings`, `country-mappings`) are declared BEFORE the dynamic
 * `:currencyId` routes so Nest never mistakes "settings" for a
 * currency id — same ordering concern as any REST controller mixing a
 * static sub-resource with a dynamic :id segment.
 */
@ApiTags('admin-currencies')
@ApiBearerAuth()
@Controller('admin/currencies')
@UseGuards(SuperAdminGuard)
export class AdminCurrenciesController {
  constructor(
    private readonly currencies: CurrencyService,
    @Inject(BILLING_PROVIDER) private readonly billingProvider: BillingProvider,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List currencies (search / active / region filters)' })
  async list(
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
    @Query('region') region?: string,
  ) {
    const currencies = await this.currencies.listAll({
      search,
      isActive: isActive === undefined ? undefined : isActive === 'true',
      region,
    });
    const providerCurrencies = this.billingProvider.getSupportedCurrencies?.();
    const settings = await this.currencies.getSettings();

    return currencies.map((currency) => ({
      ...currency,
      isDefault: currency.id === settings.defaultCurrencyId,
      isFallback: currency.id === settings.fallbackCurrencyId,
      providerAvailable: !providerCurrencies || providerCurrencies.includes(currency.code),
    }));
  }

  @Get('settings')
  @ApiOperation({ summary: 'Default currency, fallback currency, and auto-detect toggle' })
  async getSettings() {
    return this.currencies.getSettings();
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Configure default/fallback currency and auto-detect' })
  async updateSettings(
    @Body() dto: UpdateCurrencySettingsDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.currencies.updateSettings(dto, admin.id, ctx);
  }

  @Get('country-mappings')
  @ApiOperation({ summary: 'List every country -> currency mapping' })
  async listCountryMappings() {
    return this.currencies.listCountryMappings();
  }

  @Post('country-mappings')
  @ApiOperation({ summary: 'Map a country to a currency' })
  async createCountryMapping(
    @Body() dto: CreateCountryMappingDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.currencies.createCountryMapping(dto, admin.id, ctx);
  }

  @Patch('country-mappings/:mappingId')
  @ApiOperation({ summary: 'Update a country mapping' })
  async updateCountryMapping(
    @Param('mappingId') mappingId: string,
    @Body() dto: UpdateCountryMappingDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.currencies.updateCountryMapping(mappingId, dto, admin.id, ctx);
  }

  @Delete('country-mappings/:mappingId')
  @ApiOperation({ summary: 'Remove a country mapping' })
  async deleteCountryMapping(
    @Param('mappingId') mappingId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    await this.currencies.deleteCountryMapping(mappingId, admin.id, ctx);
    return { success: true };
  }

  @Get(':currencyId')
  @ApiOperation({ summary: 'View a single currency' })
  async getOne(@Param('currencyId') currencyId: string) {
    return this.currencies.getByIdOrThrow(currencyId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a currency to the catalogue' })
  async create(
    @Body() dto: CreateCurrencyDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.currencies.create(dto, admin.id, ctx);
  }

  @Patch(':currencyId')
  @ApiOperation({ summary: 'Update a currency (activate/deactivate, symbol, decimals, region, ...)' })
  @ApiResponse({ status: 200, description: 'Currency updated' })
  async update(
    @Param('currencyId') currencyId: string,
    @Body() dto: UpdateCurrencyDto,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    return this.currencies.update(currencyId, dto, admin.id, ctx);
  }

  @Delete(':currencyId')
  @ApiOperation({
    summary: 'Delete a currency — only when unused (no plan prices, mappings, or user preferences)',
  })
  async remove(
    @Param('currencyId') currencyId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Ctx() ctx: RequestContext,
  ) {
    await this.currencies.delete(currencyId, admin.id, ctx);
    return { success: true };
  }
}
