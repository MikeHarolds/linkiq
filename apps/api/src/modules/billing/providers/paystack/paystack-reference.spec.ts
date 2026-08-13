import { generatePaystackReference } from './paystack-reference';

describe('generatePaystackReference', () => {
  it('produces a reference starting with the txn- prefix', () => {
    expect(generatePaystackReference().startsWith('txn-')).toBe(true);
  });

  it('generates a different reference on every call', () => {
    expect(generatePaystackReference()).not.toBe(generatePaystackReference());
  });

  it('only uses characters Paystack allows in a reference (alphanumeric, -, ., =)', () => {
    const reference = generatePaystackReference();
    expect(reference).toMatch(/^[A-Za-z0-9\-.=]+$/);
  });

  it('has sufficient entropy (256 bits of hex, not a short/predictable id)', () => {
    const reference = generatePaystackReference();
    const randomPart = reference.slice('txn-'.length);
    expect(randomPart.length).toBe(64); // 32 bytes hex-encoded
  });
});
