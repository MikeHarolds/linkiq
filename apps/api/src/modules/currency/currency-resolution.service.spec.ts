import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { GeoIpProvider } from '../analytics/geo/geo-ip-provider.interface';
import type { PrismaService } from '../prisma/prisma.service';

import { CurrencyResolutionService } from './currency-resolution.service';
import type { CurrencyService } from './currency.service';

function makeCurrency(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'cur-usd',
    code: 'USD',
    name: 'US Dollar',
    symbol: '$',
    decimalPlaces: 2,
    isActive: true,
    ...overrides,
  };
}

describe('CurrencyResolutionService', () => {
  let prisma: MockPrismaService;
  let currencies: {
    getSettings: jest.Mock;
    findCurrencyForCountry: jest.Mock;
  };
  let geoProvider: jest.Mocked<GeoIpProvider>;
  let service: CurrencyResolutionService;

  const fallback = makeCurrency({ id: 'cur-usd', code: 'USD' });

  beforeEach(() => {
    prisma = createMockPrismaService();
    currencies = {
      getSettings: jest.fn().mockResolvedValue({
        autoDetectEnabled: true,
        fallbackCurrency: fallback,
      }),
      findCurrencyForCountry: jest.fn(),
    };
    geoProvider = { lookup: jest.fn() };
    service = new CurrencyResolutionService(
      prisma as unknown as PrismaService,
      currencies as unknown as CurrencyService,
      geoProvider,
    );
  });

  it('priority 1: an explicit, active currency always wins', async () => {
    prisma.currency.findUnique.mockResolvedValue(makeCurrency({ id: 'cur-eur', code: 'EUR' }));

    const result = await service.resolve({ explicitCurrencyCode: 'eur', userId: 'user-1' });

    expect(result.source).toBe('EXPLICIT');
    expect(result.currency.code).toBe('EUR');
    // Never even looks up the user's preference once an explicit choice wins.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('falls through when the explicit currency is unknown', async () => {
    prisma.currency.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ preferredCurrency: null });
    geoProvider.lookup.mockReturnValue({ country: null, region: null, city: null });

    const result = await service.resolve({ explicitCurrencyCode: 'ZZZ' });

    expect(result.source).toBe('FALLBACK');
  });

  it('falls through when the explicit currency is inactive', async () => {
    prisma.currency.findUnique.mockResolvedValue(makeCurrency({ isActive: false }));
    geoProvider.lookup.mockReturnValue({ country: null, region: null, city: null });

    const result = await service.resolve({ explicitCurrencyCode: 'EUR' });

    expect(result.source).toBe('FALLBACK');
  });

  it('priority 2: an authenticated user preference wins over IP detection', async () => {
    prisma.user.findUnique.mockResolvedValue({
      preferredCurrency: makeCurrency({ id: 'cur-gbp', code: 'GBP' }),
    });

    const result = await service.resolve({ userId: 'user-1', ipAddress: '102.89.1.1' });

    expect(result.source).toBe('USER_PREFERENCE');
    expect(result.currency.code).toBe('GBP');
    // Never even runs GeoIP once a preference is found.
    expect(geoProvider.lookup).not.toHaveBeenCalled();
  });

  it('ignores an inactive preferred currency and falls through', async () => {
    prisma.user.findUnique.mockResolvedValue({
      preferredCurrency: makeCurrency({ isActive: false }),
    });
    geoProvider.lookup.mockReturnValue({ country: null, region: null, city: null });

    const result = await service.resolve({ userId: 'user-1' });

    expect(result.source).toBe('FALLBACK');
  });

  it('priority 3: IP/GeoIP-detected country resolves a currency', async () => {
    geoProvider.lookup.mockReturnValue({ country: 'NG', region: null, city: null });
    currencies.findCurrencyForCountry.mockResolvedValue(makeCurrency({ id: 'cur-ngn', code: 'NGN' }));

    const result = await service.resolve({ ipAddress: '105.112.0.1' });

    expect(result.source).toBe('IP_DETECTED');
    expect(result.currency.code).toBe('NGN');
    expect(result.detectedCountry).toBe('NG');
  });

  it('priority 4: falls back to the platform fallback when auto-detect is disabled', async () => {
    currencies.getSettings.mockResolvedValue({ autoDetectEnabled: false, fallbackCurrency: fallback });

    const result = await service.resolve({ ipAddress: '105.112.0.1' });

    expect(result.source).toBe('FALLBACK');
    expect(geoProvider.lookup).not.toHaveBeenCalled();
  });

  it('falls back when GeoIP resolves no country at all (localhost/private/malformed IP)', async () => {
    geoProvider.lookup.mockReturnValue({ country: null, region: null, city: null });

    const result = await service.resolve({ ipAddress: '127.0.0.1' });

    expect(result.source).toBe('FALLBACK');
    expect(result.detectedCountry).toBeNull();
  });

  it('falls back when the detected country has no active currency mapping', async () => {
    geoProvider.lookup.mockReturnValue({ country: 'ZZ', region: null, city: null });
    currencies.findCurrencyForCountry.mockResolvedValue(null);

    const result = await service.resolve({ ipAddress: '1.2.3.4' });

    expect(result.source).toBe('FALLBACK');
  });

  it('never throws when GeoIP lookup itself throws — falls back gracefully', async () => {
    geoProvider.lookup.mockImplementation(() => {
      throw new Error('simulated GeoIP failure');
    });

    const result = await service.resolve({ ipAddress: '1.2.3.4' });

    expect(result.source).toBe('FALLBACK');
    expect(result.currency.code).toBe('USD');
  });

  it('falls back cleanly when no IP is provided at all', async () => {
    const result = await service.resolve({});

    expect(result.source).toBe('FALLBACK');
    expect(geoProvider.lookup).not.toHaveBeenCalled();
  });
});
