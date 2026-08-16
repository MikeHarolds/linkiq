import { NullExchangeRateProvider } from './null-exchange-rate.provider';

describe('NullExchangeRateProvider', () => {
  it('always reports no rate available — fixed pricing remains fully functional with no provider configured', async () => {
    const provider = new NullExchangeRateProvider();

    const result = await provider.getRate('USD', 'NGN');

    expect(result).toBeNull();
  });
});
