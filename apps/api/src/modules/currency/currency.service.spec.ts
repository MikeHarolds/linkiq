import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';

import { CurrencyService } from './currency.service';

const ctx: RequestContext = { ipAddress: '127.0.0.1', userAgent: 'jest' };

function makeCurrency(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cur-usd',
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    numericCode: '840',
    decimalPlaces: 2,
    region: 'North America',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSettings(overrides: Partial<Record<string, unknown>> = {}) {
  const usd = makeCurrency();
  return {
    id: 'settings-1',
    defaultCurrencyId: usd.id,
    defaultCurrency: usd,
    fallbackCurrencyId: usd.id,
    fallbackCurrency: usd,
    autoDetectEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('CurrencyService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let service: CurrencyService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new CurrencyService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe('create', () => {
    it('creates a new currency and audits it', async () => {
      prisma.currency.findUnique.mockResolvedValue(null);
      prisma.currency.create.mockResolvedValue(makeCurrency({ code: 'NGN', id: 'cur-ngn' }));

      const result = await service.create(
        { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
        'admin-1',
        ctx,
      );

      expect(result.code).toBe('NGN');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.currency_created' }),
      );
    });

    it('rejects a duplicate currency code', async () => {
      prisma.currency.findUnique.mockResolvedValue(makeCurrency());

      await expect(
        service.create({ code: 'USD', name: 'US Dollar', symbol: '$' }, 'admin-1', ctx),
      ).rejects.toThrow(ConflictException);
      expect(prisma.currency.create).not.toHaveBeenCalled();
    });

    it('defaults decimalPlaces to 2 when omitted', async () => {
      prisma.currency.findUnique.mockResolvedValue(null);
      prisma.currency.create.mockResolvedValue(makeCurrency());

      await service.create({ code: 'XOF', name: 'CFA Franc', symbol: 'CFA' }, 'admin-1', ctx);

      expect(prisma.currency.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ decimalPlaces: 2 }) }),
      );
    });
  });

  describe('update', () => {
    it('rejects deactivating the configured default currency', async () => {
      prisma.currency.findUnique.mockResolvedValueOnce(makeCurrency()); // getByIdOrThrow
      prisma.currencySettings.findUnique.mockResolvedValue(makeSettings());

      await expect(
        service.update('cur-usd', { isActive: false }, 'admin-1', ctx),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.currency.update).not.toHaveBeenCalled();
    });

    it('rejects deactivating the configured fallback currency', async () => {
      const ngn = makeCurrency({ id: 'cur-ngn', code: 'NGN' });
      prisma.currency.findUnique.mockResolvedValueOnce(ngn); // getByIdOrThrow
      prisma.currencySettings.findUnique.mockResolvedValue(
        makeSettings({ fallbackCurrencyId: 'cur-ngn', fallbackCurrency: ngn }),
      );

      await expect(
        service.update('cur-ngn', { isActive: false }, 'admin-1', ctx),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows deactivating a currency that is neither default nor fallback', async () => {
      const eur = makeCurrency({ id: 'cur-eur', code: 'EUR' });
      prisma.currency.findUnique.mockResolvedValueOnce(eur); // getByIdOrThrow
      prisma.currencySettings.findUnique.mockResolvedValue(makeSettings());
      prisma.currency.update.mockResolvedValue({ ...eur, isActive: false });

      const result = await service.update('cur-eur', { isActive: false }, 'admin-1', ctx);

      expect(result.isActive).toBe(false);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.currency_deactivated' }),
      );
    });

    it('throws NotFoundException for an unknown currency id', async () => {
      prisma.currency.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', {}, 'admin-1', ctx)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('delete', () => {
    it('rejects deleting the default currency', async () => {
      prisma.currency.findUnique.mockResolvedValueOnce(makeCurrency());
      prisma.currencySettings.findUnique.mockResolvedValue(makeSettings());

      await expect(service.delete('cur-usd', 'admin-1', ctx)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.currency.delete).not.toHaveBeenCalled();
    });

    it('rejects deleting a currency that is still referenced (plan prices, mappings, or user preferences)', async () => {
      const eur = makeCurrency({ id: 'cur-eur', code: 'EUR' });
      prisma.currency.findUnique.mockResolvedValueOnce(eur);
      prisma.currencySettings.findUnique.mockResolvedValue(makeSettings());
      prisma.planPrice.count.mockResolvedValue(1);
      prisma.currencyCountryMapping.count.mockResolvedValue(0);
      prisma.user.count.mockResolvedValue(0);

      await expect(service.delete('cur-eur', 'admin-1', ctx)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.currency.delete).not.toHaveBeenCalled();
    });

    it('deletes an unreferenced, non-default, non-fallback currency', async () => {
      const eur = makeCurrency({ id: 'cur-eur', code: 'EUR' });
      prisma.currency.findUnique.mockResolvedValueOnce(eur);
      prisma.currencySettings.findUnique.mockResolvedValue(makeSettings());
      prisma.planPrice.count.mockResolvedValue(0);
      prisma.currencyCountryMapping.count.mockResolvedValue(0);
      prisma.user.count.mockResolvedValue(0);
      prisma.currency.delete.mockResolvedValue(eur);

      await service.delete('cur-eur', 'admin-1', ctx);

      expect(prisma.currency.delete).toHaveBeenCalledWith({ where: { id: 'cur-eur' } });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.currency_deleted' }),
      );
    });
  });

  describe('country mappings', () => {
    it('creates a mapping against an existing currency', async () => {
      prisma.currencyCountryMapping.findUnique.mockResolvedValue(null);
      prisma.currency.findUnique.mockResolvedValue(makeCurrency());
      prisma.currencyCountryMapping.create.mockResolvedValue({
        id: 'map-1',
        countryCode: 'US',
        countryName: 'United States',
        currencyId: 'cur-usd',
      });

      const result = await service.createCountryMapping(
        { countryCode: 'us', countryName: 'United States', currencyId: 'cur-usd' },
        'admin-1',
        ctx,
      );

      expect(result.countryCode).toBe('US');
    });

    it('rejects a duplicate country mapping', async () => {
      prisma.currencyCountryMapping.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createCountryMapping(
          { countryCode: 'US', countryName: 'United States', currencyId: 'cur-usd' },
          'admin-1',
          ctx,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('findCurrencyForCountry returns null for an unmapped country', async () => {
      prisma.currencyCountryMapping.findUnique.mockResolvedValue(null);

      const result = await service.findCurrencyForCountry('ZZ');

      expect(result).toBeNull();
    });

    it('findCurrencyForCountry returns null when the mapped currency is inactive', async () => {
      prisma.currencyCountryMapping.findUnique.mockResolvedValue({
        currency: makeCurrency({ isActive: false }),
      });

      const result = await service.findCurrencyForCountry('NG');

      expect(result).toBeNull();
    });

    it('findCurrencyForCountry returns the mapped currency (never duplicating currency records per country)', async () => {
      const xof = makeCurrency({ id: 'cur-xof', code: 'XOF' });
      prisma.currencyCountryMapping.findUnique.mockResolvedValue({ currency: xof });

      const ci = await service.findCurrencyForCountry('CI');
      const sn = await service.findCurrencyForCountry('SN');

      expect(ci?.id).toBe('cur-xof');
      expect(sn?.id).toBe('cur-xof');
    });
  });

  describe('settings', () => {
    it('bootstraps the singleton from the first active currency when never configured', async () => {
      prisma.currencySettings.findUnique.mockResolvedValue(null);
      prisma.currency.findFirst.mockResolvedValue(makeCurrency());
      prisma.currencySettings.create.mockResolvedValue(makeSettings());

      const result = await service.getSettings();

      expect(result.defaultCurrency.code).toBe('USD');
      expect(prisma.currencySettings.create).toHaveBeenCalled();
    });

    it('throws when no active currency exists at all (seed misconfiguration)', async () => {
      prisma.currencySettings.findUnique.mockResolvedValue(null);
      prisma.currency.findFirst.mockResolvedValue(null);

      await expect(service.getSettings()).rejects.toThrow('No active currency exists');
    });

    it('rejects setting an inactive currency as the default', async () => {
      prisma.currencySettings.findUnique.mockResolvedValue(makeSettings());
      prisma.currency.findUnique.mockResolvedValue(makeCurrency({ isActive: false }));

      await expect(
        service.updateSettings({ defaultCurrencyId: 'cur-eur' }, 'admin-1', ctx),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates the default/fallback/auto-detect settings and audits the change', async () => {
      prisma.currencySettings.findUnique.mockResolvedValue(makeSettings());
      prisma.currency.findUnique.mockResolvedValue(makeCurrency({ id: 'cur-ngn', code: 'NGN' }));
      prisma.currencySettings.upsert.mockResolvedValue(undefined);

      await service.updateSettings({ defaultCurrencyId: 'cur-ngn' }, 'admin-1', ctx);

      expect(prisma.currencySettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ defaultCurrencyId: 'cur-ngn' }),
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.currency_settings_updated' }),
      );
    });
  });
});
