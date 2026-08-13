import { createHmac } from 'crypto';

import { WebhookSignatureService } from './webhook-signature.service';

describe('WebhookSignatureService', () => {
  let service: WebhookSignatureService;

  beforeEach(() => {
    service = new WebhookSignatureService();
  });

  describe('sign', () => {
    it('produces a sha256= prefixed hex digest', () => {
      const sig = service.sign('secret', 1700000000, '{"a":1}');
      expect(sig.startsWith('sha256=')).toBe(true);
      expect(sig.slice('sha256='.length)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('matches a manually computed HMAC-SHA256 over "timestamp.body"', () => {
      const secret = 'whsec_test';
      const timestamp = 1700000000;
      const body = '{"hello":"world"}';
      const expected = createHmac('sha256', secret)
        .update(`${timestamp}.${body}`)
        .digest('hex');

      expect(service.sign(secret, timestamp, body)).toBe(`sha256=${expected}`);
    });

    it('produces a different signature for a different timestamp (replay protection material)', () => {
      const a = service.sign('secret', 1700000000, '{}');
      const b = service.sign('secret', 1700000001, '{}');
      expect(a).not.toBe(b);
    });

    it('produces a different signature for a different body', () => {
      const a = service.sign('secret', 1700000000, '{"a":1}');
      const b = service.sign('secret', 1700000000, '{"a":2}');
      expect(a).not.toBe(b);
    });

    it('produces a different signature for a different secret', () => {
      const a = service.sign('secret-a', 1700000000, '{}');
      const b = service.sign('secret-b', 1700000000, '{}');
      expect(a).not.toBe(b);
    });
  });

  describe('verify', () => {
    it('accepts a signature produced by sign() for the same inputs', () => {
      const secret = 'whsec_test';
      const timestamp = 1700000000;
      const body = '{"hello":"world"}';
      const sig = service.sign(secret, timestamp, body);

      expect(service.verify(secret, timestamp, body, sig)).toBe(true);
    });

    it('rejects a signature computed with a different secret', () => {
      const timestamp = 1700000000;
      const body = '{}';
      const sig = service.sign('secret-a', timestamp, body);

      expect(service.verify('secret-b', timestamp, body, sig)).toBe(false);
    });

    it('rejects a signature computed with a different timestamp', () => {
      const secret = 'whsec_test';
      const body = '{}';
      const sig = service.sign(secret, 1700000000, body);

      expect(service.verify(secret, 1700000001, body, sig)).toBe(false);
    });

    it('rejects a signature computed over a different body', () => {
      const secret = 'whsec_test';
      const timestamp = 1700000000;
      const sig = service.sign(secret, timestamp, '{"a":1}');

      expect(service.verify(secret, timestamp, '{"a":2}', sig)).toBe(false);
    });

    it('rejects a malformed/truncated signature without throwing', () => {
      expect(() =>
        service.verify('secret', 1700000000, '{}', 'sha256=deadbeef'),
      ).not.toThrow();
      expect(service.verify('secret', 1700000000, '{}', 'sha256=deadbeef')).toBe(
        false,
      );
    });

    it('rejects an empty-string signature', () => {
      expect(service.verify('secret', 1700000000, '{}', '')).toBe(false);
    });
  });
});
