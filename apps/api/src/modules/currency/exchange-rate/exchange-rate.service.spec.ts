import type { ExchangeRateProvider } from './exchange-rate-provider.interface';
import { ExchangeRateService } from './exchange-rate.service';

describe('ExchangeRateService', () => {
  let provider: jest.Mocked<ExchangeRateProvider>;
  let service: ExchangeRateService;

  beforeEach(() => {
    provider = { getRate: jest.fn() };
    service = new ExchangeRateService(provider);
  });

  describe('getRate', () => {
    it('returns an identity rate of 1 without calling the provider when base === target', async () => {
      const result = await service.getRate('USD', 'USD');

      expect(result).toEqual(expect.objectContaining({ rate: 1, source: 'identity' }));
      expect(provider.getRate).not.toHaveBeenCalled();
    });

    it('delegates to the provider for a real cross-currency pair', async () => {
      provider.getRate.mockResolvedValue({
        rate: 1550.25,
        timestamp: new Date('2026-01-01T00:00:00Z'),
        source: 'fixed-config',
      });

      const result = await service.getRate('USD', 'NGN');

      expect(provider.getRate).toHaveBeenCalledWith('USD', 'NGN');
      expect(result?.rate).toBe(1550.25);
    });

    it('returns null when the provider has no rate available (e.g. NullExchangeRateProvider)', async () => {
      provider.getRate.mockResolvedValue(null);

      const result = await service.getRate('USD', 'EUR');

      expect(result).toBeNull();
    });
  });

  describe('convert', () => {
    it('returns null (never a fabricated amount) when no rate is available', async () => {
      provider.getRate.mockResolvedValue(null);

      const result = await service.convert(4900, 'USD', 'EUR');

      expect(result).toBeNull();
    });

    it('converts and rounds to the nearest minor unit', async () => {
      provider.getRate.mockResolvedValue({
        rate: 1531.6,
        timestamp: new Date('2026-01-01T00:00:00Z'),
        source: 'fixed-config',
      });

      const result = await service.convert(4900, 'USD', 'NGN');

      expect(result?.amount).toBe(Math.round(4900 * 1531.6));
      expect(Number.isInteger(result?.amount)).toBe(true);
    });

    it('is a pure passthrough (amount unchanged) for the same currency', async () => {
      const result = await service.convert(4900, 'USD', 'USD');

      expect(result?.amount).toBe(4900);
      expect(provider.getRate).not.toHaveBeenCalled();
    });
  });
});
