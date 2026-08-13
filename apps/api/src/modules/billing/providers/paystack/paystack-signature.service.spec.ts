import { createHmac } from 'crypto';

import { PaystackSignatureService } from './paystack-signature.service';

describe('PaystackSignatureService', () => {
  let service: PaystackSignatureService;
  const secretKey = 'sk_test_abc123';

  beforeEach(() => {
    service = new PaystackSignatureService();
  });

  function sign(secret: string, body: string): string {
    return createHmac('sha512', secret).update(body).digest('hex');
  }

  it('accepts a signature computed the same way over the same raw body', () => {
    const rawBody = '{"event":"charge.success","data":{"reference":"txn-abc"}}';
    const signature = sign(secretKey, rawBody);

    expect(service.verify(secretKey, rawBody, signature)).toBe(true);
  });

  it('accepts a Buffer raw body identically to the equivalent string', () => {
    const rawBody = '{"event":"charge.success"}';
    const signature = sign(secretKey, rawBody);

    expect(
      service.verify(secretKey, Buffer.from(rawBody, 'utf8'), signature),
    ).toBe(true);
  });

  it('rejects a signature computed with a different secret key', () => {
    const rawBody = '{"event":"charge.success"}';
    const signature = sign('sk_test_wrong', rawBody);

    expect(service.verify(secretKey, rawBody, signature)).toBe(false);
  });

  it('rejects a signature computed over a different body (tampered payload)', () => {
    const original = '{"event":"charge.success","data":{"amount":1000}}';
    const tampered = '{"event":"charge.success","data":{"amount":100000}}';
    const signature = sign(secretKey, original);

    expect(service.verify(secretKey, tampered, signature)).toBe(false);
  });

  it('rejects when a JSON.stringify(parsed) re-serialization differs from the true raw body', () => {
    // Demonstrates exactly the risk called out in the class docs: a
    // byte-different-but-semantically-equal re-serialization must NOT
    // verify against a signature computed over the true original bytes.
    const rawBody = '{"event":"charge.success","data":{"a":1,"b":2}}';
    const reserialized = JSON.stringify({
      event: 'charge.success',
      data: { b: 2, a: 1 },
    });
    const signature = sign(secretKey, rawBody);

    expect(rawBody).not.toBe(reserialized);
    expect(service.verify(secretKey, reserialized, signature)).toBe(false);
  });

  it('rejects a missing signature without throwing', () => {
    expect(() => service.verify(secretKey, '{}', undefined)).not.toThrow();
    expect(service.verify(secretKey, '{}', undefined)).toBe(false);
  });

  it('rejects an empty-string signature', () => {
    expect(service.verify(secretKey, '{}', '')).toBe(false);
  });

  it('rejects a malformed/truncated signature without throwing', () => {
    expect(() => service.verify(secretKey, '{}', 'deadbeef')).not.toThrow();
    expect(service.verify(secretKey, '{}', 'deadbeef')).toBe(false);
  });
});
