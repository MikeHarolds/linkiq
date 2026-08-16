import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Currency, CurrencyCountryMapping, CurrencySettings, Prisma } from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import type { CreateCountryMappingDto } from './dto/create-country-mapping.dto';
import type { CreateCurrencyDto } from './dto/create-currency.dto';
import type { UpdateCountryMappingDto } from './dto/update-country-mapping.dto';
import type { UpdateCurrencySettingsDto } from './dto/update-currency-settings.dto';
import type { UpdateCurrencyDto } from './dto/update-currency.dto';

/** Fixed id for the single CurrencySettings row — same enforced-
 * singleton pattern BrandingService uses for SiteBranding (see that
 * service's own docs). Every read/write here targets exactly this id. */
const SETTINGS_SINGLETON_ID = '00000000-0000-0000-0000-000000000002';

export type CurrencySettingsWithCurrencies = CurrencySettings & {
  defaultCurrency: Currency;
  fallbackCurrency: Currency;
};

const CACHE_TTL_MS = 60 * 1000;

/**
 * Super Admin currency catalogue, country->currency mapping, and the
 * platform-wide default/fallback/auto-detect settings singleton
 * (Sprint 16). Every mutation is audited via the existing AuditService
 * — no separate audit mechanism. Deliberately does NOT know about
 * BillingProvider/Paystack at all: "is this currency active in
 * LinkIQ" and "does the configured payment provider support charging
 * in it" are two different questions (Sprint 16 §11) — the second one
 * is answered by BillingProvider.getSupportedCurrencies() at the
 * checkout/plan-price call sites, never here.
 */
@Injectable()
export class CurrencyService {
  private settingsCache: { settings: CurrencySettingsWithCurrencies; expiresAt: number } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listAll(filters: {
    search?: string;
    isActive?: boolean;
    region?: string;
  } = {}): Promise<Currency[]> {
    const searchTerm = filters.search?.trim();
    return this.prisma.currency.findMany({
      where: {
        ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
        ...(filters.region ? { region: filters.region } : {}),
        ...(searchTerm
          ? {
              OR: [
                { code: { contains: searchTerm, mode: 'insensitive' } },
                { name: { contains: searchTerm, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { code: 'asc' },
    });
  }

  async listActive(): Promise<Currency[]> {
    return this.prisma.currency.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async getByIdOrThrow(currencyId: string): Promise<Currency> {
    const currency = await this.prisma.currency.findUnique({ where: { id: currencyId } });
    if (!currency) {
      throw new NotFoundException('Currency not found');
    }
    return currency;
  }

  async getByCodeOrThrow(code: string): Promise<Currency> {
    const currency = await this.prisma.currency.findUnique({ where: { code } });
    if (!currency) {
      throw new NotFoundException(`Currency "${code}" is not configured`);
    }
    return currency;
  }

  async create(
    input: CreateCurrencyDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<Currency> {
    const code = input.code.toUpperCase();
    const existing = await this.prisma.currency.findUnique({ where: { code } });
    if (existing) {
      throw new ConflictException(`Currency "${code}" already exists`);
    }

    const currency = await this.prisma.currency.create({
      data: {
        code,
        name: input.name,
        symbol: input.symbol,
        numericCode: input.numericCode,
        decimalPlaces: input.decimalPlaces ?? 2,
        region: input.region,
        isActive: input.isActive ?? true,
      },
    });

    await this.audit.record({
      action: 'admin.currency_created',
      entity: 'Currency',
      entityId: currency.id,
      userId: adminUserId,
      metadata: { code: currency.code, name: currency.name },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return currency;
  }

  async update(
    currencyId: string,
    input: UpdateCurrencyDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<Currency> {
    const existing = await this.getByIdOrThrow(currencyId);

    // Deactivating the currently-configured default/fallback would leave
    // the platform without a valid fallback (Sprint 16 §5's explicit
    // "never leave the application without a valid fallback currency")
    // — reject rather than silently leaving CurrencySettings pointing at
    // an inactive row.
    if (input.isActive === false) {
      const settings = await this.getSettings();
      if (settings.defaultCurrencyId === currencyId) {
        throw new BadRequestException(
          'Cannot deactivate the platform default currency — set a different default first',
        );
      }
      if (settings.fallbackCurrencyId === currencyId) {
        throw new BadRequestException(
          'Cannot deactivate the platform fallback currency — set a different fallback first',
        );
      }
    }

    const currency = await this.prisma.currency.update({
      where: { id: currencyId },
      data: {
        name: input.name,
        symbol: input.symbol,
        numericCode: input.numericCode,
        decimalPlaces: input.decimalPlaces,
        region: input.region,
        isActive: input.isActive,
      },
    });

    this.settingsCache = null;

    await this.audit.record({
      action:
        input.isActive !== undefined && input.isActive !== existing.isActive
          ? input.isActive
            ? 'admin.currency_activated'
            : 'admin.currency_deactivated'
          : 'admin.currency_updated',
      entity: 'Currency',
      entityId: currency.id,
      userId: adminUserId,
      metadata: JSON.parse(
        JSON.stringify({ code: currency.code, changes: input }),
      ) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return currency;
  }

  /**
   * Hard-deletes a currency — only when nothing references it (no
   * PlanPrice, no country mapping, no user preference, not the
   * configured default/fallback). Mirrors PlatformRolesService.delete's
   * exact "reject with a clear message, never silently downgrade to
   * deactivate" pattern: a currency with any real usage must be
   * deactivated (isActive: false) instead, which is reversible and
   * doesn't orphan foreign keys.
   */
  async delete(currencyId: string, adminUserId: string, ctx: RequestContext): Promise<void> {
    const currency = await this.getByIdOrThrow(currencyId);
    const settings = await this.getSettings();
    if (settings.defaultCurrencyId === currencyId || settings.fallbackCurrencyId === currencyId) {
      throw new BadRequestException(
        'Cannot delete the platform default or fallback currency — change the setting first',
      );
    }

    const [planPriceCount, mappingCount, userCount] = await Promise.all([
      this.prisma.planPrice.count({ where: { currencyId } }),
      this.prisma.currencyCountryMapping.count({ where: { currencyId } }),
      this.prisma.user.count({ where: { preferredCurrencyId: currencyId } }),
    ]);
    if (planPriceCount > 0 || mappingCount > 0 || userCount > 0) {
      throw new BadRequestException(
        'This currency is in use (plan prices, country mappings, or user preferences) — deactivate it instead of deleting',
      );
    }

    await this.prisma.currency.delete({ where: { id: currencyId } });

    await this.audit.record({
      action: 'admin.currency_deleted',
      entity: 'Currency',
      entityId: currencyId,
      userId: adminUserId,
      metadata: { code: currency.code },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  // -------------------------------------------------------------------
  // Country -> Currency mapping
  // -------------------------------------------------------------------

  async listCountryMappings(): Promise<Array<CurrencyCountryMapping & { currency: Currency }>> {
    return this.prisma.currencyCountryMapping.findMany({
      include: { currency: true },
      orderBy: { countryCode: 'asc' },
    });
  }

  async createCountryMapping(
    input: CreateCountryMappingDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<CurrencyCountryMapping> {
    const countryCode = input.countryCode.toUpperCase();
    const existing = await this.prisma.currencyCountryMapping.findUnique({
      where: { countryCode },
    });
    if (existing) {
      throw new ConflictException(`A mapping for "${countryCode}" already exists`);
    }
    const currency = await this.getByIdOrThrow(input.currencyId);

    const mapping = await this.prisma.currencyCountryMapping.create({
      data: {
        countryCode,
        countryName: input.countryName,
        currencyId: currency.id,
      },
    });

    await this.audit.record({
      action: 'admin.currency_country_mapping_created',
      entity: 'CurrencyCountryMapping',
      entityId: mapping.id,
      userId: adminUserId,
      metadata: { countryCode, currencyCode: currency.code },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return mapping;
  }

  async updateCountryMapping(
    mappingId: string,
    input: UpdateCountryMappingDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<CurrencyCountryMapping> {
    const existing = await this.prisma.currencyCountryMapping.findUnique({
      where: { id: mappingId },
    });
    if (!existing) {
      throw new NotFoundException('Country mapping not found');
    }
    if (input.currencyId) {
      await this.getByIdOrThrow(input.currencyId);
    }

    const mapping = await this.prisma.currencyCountryMapping.update({
      where: { id: mappingId },
      data: {
        countryName: input.countryName,
        currencyId: input.currencyId,
      },
    });

    await this.audit.record({
      action: 'admin.currency_country_mapping_updated',
      entity: 'CurrencyCountryMapping',
      entityId: mapping.id,
      userId: adminUserId,
      metadata: JSON.parse(
        JSON.stringify({ countryCode: existing.countryCode, changes: input }),
      ) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return mapping;
  }

  async deleteCountryMapping(
    mappingId: string,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<void> {
    const existing = await this.prisma.currencyCountryMapping.findUnique({
      where: { id: mappingId },
    });
    if (!existing) {
      throw new NotFoundException('Country mapping not found');
    }

    await this.prisma.currencyCountryMapping.delete({ where: { id: mappingId } });

    await this.audit.record({
      action: 'admin.currency_country_mapping_deleted',
      entity: 'CurrencyCountryMapping',
      entityId: mappingId,
      userId: adminUserId,
      metadata: { countryCode: existing.countryCode },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  async findCurrencyForCountry(countryCode: string): Promise<Currency | null> {
    const mapping = await this.prisma.currencyCountryMapping.findUnique({
      where: { countryCode: countryCode.toUpperCase() },
      include: { currency: true },
    });
    if (!mapping || !mapping.currency.isActive) {
      return null;
    }
    return mapping.currency;
  }

  // -------------------------------------------------------------------
  // Platform settings (default / fallback / auto-detect) — singleton
  // -------------------------------------------------------------------

  /** Bootstraps the singleton against whatever currency is already
   * marked active if it has never been configured — should only ever
   * actually create on a fresh database the seed script hasn't run
   * against yet; the seed script itself always seeds this explicitly
   * (see seedCurrencies), so this create branch is a safety net, not
   * the primary path. */
  async getSettings(): Promise<CurrencySettingsWithCurrencies> {
    const now = Date.now();
    if (this.settingsCache && this.settingsCache.expiresAt > now) {
      return this.settingsCache.settings;
    }

    let settings = await this.prisma.currencySettings.findUnique({
      where: { id: SETTINGS_SINGLETON_ID },
      include: { defaultCurrency: true, fallbackCurrency: true },
    });

    if (!settings) {
      const fallback = await this.prisma.currency.findFirst({
        where: { isActive: true },
        orderBy: { code: 'asc' },
      });
      if (!fallback) {
        throw new Error(
          'No active currency exists — run the seed script before serving currency-dependent routes',
        );
      }
      settings = await this.prisma.currencySettings.create({
        data: {
          id: SETTINGS_SINGLETON_ID,
          defaultCurrencyId: fallback.id,
          fallbackCurrencyId: fallback.id,
          autoDetectEnabled: true,
        },
        include: { defaultCurrency: true, fallbackCurrency: true },
      });
    }

    this.settingsCache = { settings, expiresAt: now + CACHE_TTL_MS };
    return settings;
  }

  async updateSettings(
    input: UpdateCurrencySettingsDto,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<CurrencySettingsWithCurrencies> {
    const current = await this.getSettings();

    const nextDefaultId = input.defaultCurrencyId ?? current.defaultCurrencyId;
    const nextFallbackId = input.fallbackCurrencyId ?? current.fallbackCurrencyId;

    if (input.defaultCurrencyId) {
      const currency = await this.getByIdOrThrow(input.defaultCurrencyId);
      if (!currency.isActive) {
        throw new BadRequestException('The default currency must be active');
      }
    }
    if (input.fallbackCurrencyId) {
      const currency = await this.getByIdOrThrow(input.fallbackCurrencyId);
      if (!currency.isActive) {
        throw new BadRequestException('The fallback currency must be active');
      }
    }

    await this.prisma.currencySettings.upsert({
      where: { id: SETTINGS_SINGLETON_ID },
      create: {
        id: SETTINGS_SINGLETON_ID,
        defaultCurrencyId: nextDefaultId,
        fallbackCurrencyId: nextFallbackId,
        autoDetectEnabled: input.autoDetectEnabled ?? true,
      },
      update: {
        defaultCurrencyId: input.defaultCurrencyId,
        fallbackCurrencyId: input.fallbackCurrencyId,
        autoDetectEnabled: input.autoDetectEnabled,
      },
    });

    this.settingsCache = null;

    await this.audit.record({
      action: 'admin.currency_settings_updated',
      entity: 'CurrencySettings',
      entityId: SETTINGS_SINGLETON_ID,
      userId: adminUserId,
      metadata: JSON.parse(
        JSON.stringify({
          previous: {
            defaultCurrencyCode: current.defaultCurrency.code,
            fallbackCurrencyCode: current.fallbackCurrency.code,
            autoDetectEnabled: current.autoDetectEnabled,
          },
          changes: input,
        }),
      ) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.getSettings();
  }
}
