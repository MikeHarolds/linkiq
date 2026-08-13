import * as dns from 'dns/promises';
import * as net from 'net';

import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * SSRF protection for webhook destinations (docs/architecture/webhooks.md
 * §SSRF). Webhook URLs are entirely user-controlled — without this guard,
 * LinkIQ's own delivery workers would be a ready-made SSRF proxy able to
 * reach the app's internal network, other containers, and cloud metadata
 * endpoints on the attacker's behalf.
 *
 * Called from TWO places, deliberately: `WebhooksService` at
 * create/update time (fast rejection, good UX) and again inside
 * `WebhookDeliveryProcessor` immediately before every HTTP attempt
 * (defense against DNS-rebinding/TOCTOU — a hostname's DNS can change
 * between when an endpoint was saved and when it's actually delivered
 * to). Never relies on a hostname string check alone: any hostname that
 * isn't already a literal IP is resolved via DNS, and the *resolved*
 * address is what gets classified — this also transparently handles
 * non-canonical IPv4 literals (e.g. "127.1", decimal/hex/octal forms)
 * since the WHATWG URL parser already canonicalizes those into a literal
 * IP `net.isIP` recognizes directly, and anything DNS resolves is
 * checked the same way as a literal.
 */
type AddressClass =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'unique-local'
  | 'unspecified';

const DNS_LOOKUP_TIMEOUT_MS = 5000;

const BLOCKED_IPV4_CIDRS: Array<{ cidr: string; label: AddressClass }> = [
  { cidr: '0.0.0.0/8', label: 'unspecified' },
  { cidr: '127.0.0.0/8', label: 'loopback' },
  { cidr: '169.254.0.0/16', label: 'link-local' }, // includes cloud metadata (169.254.169.254)
  { cidr: '10.0.0.0/8', label: 'private' },
  { cidr: '172.16.0.0/12', label: 'private' },
  { cidr: '192.168.0.0/16', label: 'private' },
  { cidr: '100.64.0.0/10', label: 'private' }, // carrier-grade NAT / shared address space
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (
    (((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>>
    0)
  );
}

function isIpv4InCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(rangeIp!) & mask);
}

function classifyIpv4(ip: string): AddressClass {
  for (const { cidr, label } of BLOCKED_IPV4_CIDRS) {
    if (isIpv4InCidr(ip, cidr)) return label;
  }
  return 'public';
}

function classifyIpv6(ip: string): AddressClass {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return 'loopback';
  if (normalized === '::') return 'unspecified';

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — unwrap and classify the embedded
  // IPv4 address, so e.g. ::ffff:127.0.0.1 is caught as loopback too.
  // Handled in both notations RFC 4291 permits: the dotted-quad form
  // most resolvers emit ("::ffff:127.0.0.1") AND the pure-hex form
  // ("::ffff:7f00:1") a resolver or library is still free to return —
  // relying on the dotted-quad pattern alone would let the identical
  // address slip through classified as "public" merely by being spelled
  // differently.
  const mappedDotted = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedDotted) return classifyIpv4(mappedDotted[1]!);

  const mappedHex = normalized.match(
    /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/,
  );
  if (mappedHex) {
    const high = parseInt(mappedHex[1]!, 16);
    const low = parseInt(mappedHex[2]!, 16);
    const octets = [
      (high >> 8) & 0xff,
      high & 0xff,
      (low >> 8) & 0xff,
      low & 0xff,
    ];
    return classifyIpv4(octets.join('.'));
  }

  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return 'link-local'; // fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return 'unique-local'; // fc00::/7
  return 'public';
}

function classifyAddress(address: string): AddressClass {
  const version = net.isIP(address);
  if (version === 4) return classifyIpv4(address);
  if (version === 6) return classifyIpv6(address);
  // Not a recognizable IP shape at all — fail closed rather than treat
  // it as safe.
  return 'private';
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  if (net.isIP(hostname)) {
    return [hostname];
  }
  if (hostname.toLowerCase() === 'localhost') {
    // Resolver behavior for the literal string "localhost" is
    // inconsistent across environments (some return ::1 first, some
    // 127.0.0.1) — treat it as loopback directly rather than depending
    // on that, since either resolution means the same thing here.
    return ['127.0.0.1'];
  }

  const lookup = dns.lookup(hostname, { all: true, verbatim: true });
  let timeoutHandle: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error('DNS resolution timed out')),
      DNS_LOOKUP_TIMEOUT_MS,
    );
  });

  try {
    const results = await Promise.race([lookup, timeout]);
    return results.map((r) => r.address);
  } catch {
    return [];
  } finally {
    // Without this, a lookup that resolves before the timeout still
    // leaves the timer pending, keeping the event loop (and in tests,
    // the Jest worker) alive until it eventually fires.
    clearTimeout(timeoutHandle!);
  }
}

@Injectable()
export class WebhookUrlGuard {
  constructor(private readonly config: ConfigService) {}

  /**
   * Throws BadRequestException if the URL is unsafe. Resolves silently
   * otherwise. `allowHttpLocalhostOverride` lets a caller (currently
   * only tests) force the behavior without touching process.env; normal
   * callers omit it and get the configured WEBHOOK_ALLOW_HTTP_LOCALHOST
   * value.
   */
  async assertSafe(
    rawUrl: string,
    allowHttpLocalhostOverride?: boolean,
  ): Promise<void> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new BadRequestException('Invalid webhook URL');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException('Webhook URL must use http or https');
    }

    const allowHttpLocalhost =
      allowHttpLocalhostOverride ??
      this.config.get<boolean>('webhooks.allowHttpLocalhost') ??
      false;

    const addresses = await resolveAddresses(url.hostname);
    if (addresses.length === 0) {
      throw new BadRequestException(
        'Webhook URL hostname could not be resolved',
      );
    }

    const classifications = addresses.map(classifyAddress);
    const allLoopback = classifications.every((c) => c === 'loopback');
    const httpLoopbackExempt =
      url.protocol === 'http:' && allowHttpLocalhost && allLoopback;

    if (!httpLoopbackExempt) {
      const unsafe = classifications.find((c) => c !== 'public');
      if (unsafe) {
        throw new BadRequestException(
          `This webhook URL resolves to a ${unsafe} address, which is not allowed`,
        );
      }
      if (url.protocol === 'http:') {
        throw new BadRequestException('Webhook URLs must use HTTPS');
      }
    }
  }
}
