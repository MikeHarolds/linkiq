import * as dns from 'dns/promises';

import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { WebhookUrlGuard } from './webhook-url-guard';

jest.mock('dns/promises', () => ({
  lookup: jest.fn(),
}));

const mockedLookup = dns.lookup as jest.Mock;

function makeConfig(allowHttpLocalhost = false): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'webhooks.allowHttpLocalhost') return allowHttpLocalhost;
      return undefined;
    }),
  } as unknown as ConfigService;
}

describe('WebhookUrlGuard', () => {
  beforeEach(() => {
    mockedLookup.mockReset();
  });

  it('rejects a non-http(s) scheme', async () => {
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(guard.assertSafe('ftp://example.com')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a malformed URL', async () => {
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(guard.assertSafe('not a url')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects localhost (literal hostname, treated as loopback without a DNS call)', async () => {
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(guard.assertSafe('https://localhost/webhook')).rejects.toThrow(
      BadRequestException,
    );
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('rejects a literal loopback IPv4 address (127.0.0.1)', async () => {
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('https://127.0.0.1/webhook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a literal loopback IPv6 address (::1)', async () => {
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(guard.assertSafe('https://[::1]/webhook')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a hostname resolving to a private IPv4 range (10.0.0.0/8)', async () => {
    mockedLookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('https://internal.example.com/webhook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a hostname resolving to a private IPv4 range (192.168.0.0/16)', async () => {
    mockedLookup.mockResolvedValue([{ address: '192.168.1.1', family: 4 }]);
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('https://internal.example.com/webhook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a hostname resolving to a private IPv4 range (172.16.0.0/12)', async () => {
    mockedLookup.mockResolvedValue([{ address: '172.20.5.5', family: 4 }]);
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('https://internal.example.com/webhook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a hostname resolving to the link-local / cloud metadata range (169.254.0.0/16)', async () => {
    mockedLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('https://metadata.example.com/webhook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a hostname resolving to a unique-local IPv6 range (fc00::/7)', async () => {
    mockedLookup.mockResolvedValue([{ address: 'fd12:3456:789a::1', family: 6 }]);
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('https://internal.example.com/webhook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a hostname resolving to a link-local IPv6 range (fe80::/10)', async () => {
    mockedLookup.mockResolvedValue([{ address: 'fe80::1', family: 6 }]);
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('https://internal.example.com/webhook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an IPv4-mapped IPv6 loopback address in dotted-quad notation (::ffff:127.0.0.1)', async () => {
    mockedLookup.mockResolvedValue([{ address: '::ffff:127.0.0.1', family: 6 }]);
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('https://sneaky.example.com/webhook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects the same IPv4-mapped loopback address in pure-hex notation (::ffff:7f00:1)', async () => {
    mockedLookup.mockResolvedValue([{ address: '::ffff:7f00:1', family: 6 }]);
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('https://sneaky2.example.com/webhook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an IPv4-mapped private address in pure-hex notation (::ffff:a00:1 -> 10.0.0.1)', async () => {
    mockedLookup.mockResolvedValue([{ address: '::ffff:a00:1', family: 6 }]);
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('https://sneaky3.example.com/webhook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when even one of several resolved addresses is private (any-unsafe-blocks-all)', async () => {
    mockedLookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('https://mixed.example.com/webhook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a plain http:// URL to a public address (HTTPS required by default)', async () => {
    mockedLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('http://public.example.com/webhook'),
    ).rejects.toThrow(BadRequestException);
  });

  it('allows a public HTTPS URL resolving to a public address', async () => {
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('https://public.example.com/webhook'),
    ).resolves.toBeUndefined();
  });

  it('fails closed when DNS resolution errors out', async () => {
    mockedLookup.mockRejectedValue(new Error('ENOTFOUND'));
    const guard = new WebhookUrlGuard(makeConfig());
    await expect(
      guard.assertSafe('https://nonexistent.example.invalid/webhook'),
    ).rejects.toThrow(BadRequestException);
  });

  describe('WEBHOOK_ALLOW_HTTP_LOCALHOST exception', () => {
    it('allows http://localhost when the flag is enabled', async () => {
      const guard = new WebhookUrlGuard(makeConfig(true));
      await expect(
        guard.assertSafe('http://localhost:3999/webhook'),
      ).resolves.toBeUndefined();
    });

    it('still rejects http:// to a private (non-loopback) address even with the flag enabled', async () => {
      mockedLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
      const guard = new WebhookUrlGuard(makeConfig(true));
      await expect(
        guard.assertSafe('http://internal.example.com/webhook'),
      ).rejects.toThrow(BadRequestException);
    });

    it('still rejects http:// to a public address even with the flag enabled (exception is loopback-only)', async () => {
      mockedLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
      const guard = new WebhookUrlGuard(makeConfig(true));
      await expect(
        guard.assertSafe('http://public.example.com/webhook'),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not exempt https:// loopback URLs from anything (the exception is http-only)', async () => {
      const guard = new WebhookUrlGuard(makeConfig(true));
      await expect(
        guard.assertSafe('https://localhost:3999/webhook'),
      ).rejects.toThrow(BadRequestException);
    });

    it('an explicit per-call override can enable the exception independent of config', async () => {
      const guard = new WebhookUrlGuard(makeConfig(false));
      await expect(
        guard.assertSafe('http://localhost:3999/webhook', true),
      ).resolves.toBeUndefined();
    });
  });
});
