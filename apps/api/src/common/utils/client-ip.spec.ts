import type { IncomingHttpHeaders } from 'http';

import { extractClientIp } from './client-ip';

function headers(
  overrides: Partial<IncomingHttpHeaders> = {},
): IncomingHttpHeaders {
  return { ...overrides };
}

describe('extractClientIp', () => {
  describe('no proxy headers (direct connection / local dev)', () => {
    it('falls back to the socket remote address', () => {
      expect(extractClientIp(headers(), '203.0.113.7')).toBe('203.0.113.7');
    });

    it('returns undefined when the socket address is also missing', () => {
      expect(extractClientIp(headers(), undefined)).toBeUndefined();
    });

    it('resolves loopback correctly (does not invent a country/identity — just an IP)', () => {
      expect(extractClientIp(headers(), '127.0.0.1')).toBe('127.0.0.1');
      expect(extractClientIp(headers(), '::1')).toBe('::1');
    });
  });

  describe('X-Real-IP (single trusted hop — the default topology)', () => {
    it('uses X-Real-IP when present and valid', () => {
      const h = headers({ 'x-real-ip': '198.51.100.23' });
      expect(extractClientIp(h, '127.0.0.1')).toBe('198.51.100.23');
    });

    it('ignores a malformed X-Real-IP and falls through to the socket address', () => {
      const h = headers({ 'x-real-ip': 'not-an-ip' });
      expect(extractClientIp(h, '203.0.113.7')).toBe('203.0.113.7');
    });

    it('takes the first array entry if X-Real-IP somehow arrives as an array', () => {
      const h = headers({
        'x-real-ip': ['198.51.100.23', '203.0.113.99'] as unknown as string,
      });
      expect(extractClientIp(h, '127.0.0.1')).toBe('198.51.100.23');
    });
  });

  describe('X-Forwarded-For — single hop (trustedHops=1, the default)', () => {
    it('uses the single entry when only one is present', () => {
      const h = headers({ 'x-forwarded-for': '198.51.100.23' });
      expect(extractClientIp(h, '127.0.0.1')).toBe('198.51.100.23');
    });

    it('trusts only the LAST entry when nginx appended it after a client-supplied value', () => {
      // nginx's $proxy_add_x_forwarded_for APPENDS the real peer after
      // whatever the client sent — "203.0.113.99" here is nginx's own
      // view of the connection, "6.6.6.6" is attacker-supplied.
      const h = headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.99' });
      expect(extractClientIp(h, '127.0.0.1')).toBe('203.0.113.99');
    });

    it('never returns an attacker-supplied leading entry', () => {
      const h = headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.99' });
      expect(extractClientIp(h, '127.0.0.1')).not.toBe('6.6.6.6');
    });

    it('handles more than two chained entries, still trusting only the last', () => {
      const h = headers({
        'x-forwarded-for': '6.6.6.6, 7.7.7.7, 203.0.113.99',
      });
      expect(extractClientIp(h, '127.0.0.1')).toBe('203.0.113.99');
    });
  });

  describe('precedence between X-Real-IP and X-Forwarded-For', () => {
    it('prefers X-Real-IP over X-Forwarded-For at the default single-hop trust level', () => {
      const h = headers({
        'x-real-ip': '198.51.100.23',
        'x-forwarded-for': '6.6.6.6, 203.0.113.99',
      });
      // Both are nginx-authored signals for a single hop and should
      // normally agree; when only one is usable, X-Real-IP wins because
      // it can never carry a client-appended prefix the way XFF can.
      expect(extractClientIp(h, '127.0.0.1')).toBe('198.51.100.23');
    });

    it('falls back to X-Forwarded-For when X-Real-IP is absent', () => {
      const h = headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.99' });
      expect(extractClientIp(h, '127.0.0.1')).toBe('203.0.113.99');
    });

    it('falls back to X-Forwarded-For when X-Real-IP is malformed', () => {
      const h = headers({
        'x-real-ip': 'garbage',
        'x-forwarded-for': '203.0.113.99',
      });
      expect(extractClientIp(h, '127.0.0.1')).toBe('203.0.113.99');
    });
  });

  describe('multi-hop deployments (trustedHops > 1)', () => {
    it('ignores X-Real-IP entirely once more than one hop is trusted (it only reflects the last hop)', () => {
      const h = headers({
        'x-real-ip': '10.0.0.5', // e.g. an intermediate hop's own address
        'x-forwarded-for': '6.6.6.6, 203.0.113.99, 10.0.0.5',
      });
      // With 2 trusted hops, the real client is 2 entries back from the
      // end: "203.0.113.99", not X-Real-IP's "10.0.0.5" (the nearer hop).
      expect(extractClientIp(h, '127.0.0.1', 2)).toBe('203.0.113.99');
    });

    it('walks back exactly N trusted hops for N=3', () => {
      const h = headers({
        'x-forwarded-for': '6.6.6.6, 1.1.1.1, 2.2.2.2, 3.3.3.3',
      });
      expect(extractClientIp(h, '127.0.0.1', 3)).toBe('1.1.1.1');
    });

    it('clamps to the earliest available entry when there are fewer entries than trusted hops', () => {
      const h = headers({ 'x-forwarded-for': '203.0.113.99' });
      expect(extractClientIp(h, '127.0.0.1', 5)).toBe('203.0.113.99');
    });
  });

  describe('IPv4 and IPv6', () => {
    it('accepts a valid IPv4 address via X-Forwarded-For', () => {
      const h = headers({ 'x-forwarded-for': '198.51.100.23' });
      expect(extractClientIp(h, undefined)).toBe('198.51.100.23');
    });

    it('accepts a valid IPv6 address via X-Forwarded-For', () => {
      const h = headers({ 'x-forwarded-for': '2001:db8::1' });
      expect(extractClientIp(h, undefined)).toBe('2001:db8::1');
    });

    it('accepts a valid IPv6 address via X-Real-IP', () => {
      const h = headers({ 'x-real-ip': '2001:4860:4860::8888' });
      expect(extractClientIp(h, undefined)).toBe('2001:4860:4860::8888');
    });

    it('accepts a valid IPv6 loopback via the socket fallback', () => {
      expect(extractClientIp(headers(), '::1')).toBe('::1');
    });
  });

  describe('malformed values', () => {
    it('skips a non-IP X-Forwarded-For entry and falls back to the socket address', () => {
      const h = headers({ 'x-forwarded-for': 'not-an-ip' });
      expect(extractClientIp(h, '203.0.113.7')).toBe('203.0.113.7');
    });

    it('skips an empty X-Forwarded-For value', () => {
      const h = headers({ 'x-forwarded-for': '' });
      expect(extractClientIp(h, '203.0.113.7')).toBe('203.0.113.7');
    });

    it('skips whitespace-only / empty comma-separated entries', () => {
      const h = headers({ 'x-forwarded-for': '  , , 203.0.113.99' });
      expect(extractClientIp(h, '127.0.0.1')).toBe('203.0.113.99');
    });

    it('returns undefined when every signal is missing or invalid', () => {
      const h = headers({
        'x-real-ip': 'garbage',
        'x-forwarded-for': 'also garbage',
      });
      expect(extractClientIp(h, 'still garbage')).toBeUndefined();
    });

    it('does not throw on a wildly malformed X-Forwarded-For value', () => {
      const h = headers({ 'x-forwarded-for': ',,,,,' });
      expect(() => extractClientIp(h, '203.0.113.7')).not.toThrow();
      expect(extractClientIp(h, '203.0.113.7')).toBe('203.0.113.7');
    });
  });
});
