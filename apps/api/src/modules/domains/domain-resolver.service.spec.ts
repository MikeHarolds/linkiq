import { DomainStatus } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';

import type { DomainCacheService } from './domain-cache.service';
import { DomainResolverService } from './domain-resolver.service';

describe('DomainResolverService', () => {
  let prisma: MockPrismaService;
  let cache: { get: jest.Mock; set: jest.Mock; setNotFound: jest.Mock };
  let service: DomainResolverService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    prisma = createMockPrismaService();
    cache = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      setNotFound: jest.fn().mockResolvedValue(undefined),
    };
    service = new DomainResolverService(
      prisma as unknown as never,
      cache as unknown as DomainCacheService,
    );
    process.env.APP_URL = 'http://localhost:3000';
    delete process.env.REDIRECT_DEFAULT_HOSTS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('isDefaultHost', () => {
    it("treats APP_URL's own hostname as default", () => {
      expect(service.isDefaultHost('localhost')).toBe(true);
    });

    it('always treats loopback hostnames as default, regardless of APP_URL', () => {
      process.env.APP_URL = 'https://app.linkiq.com';
      expect(service.isDefaultHost('127.0.0.1')).toBe(true);
      expect(service.isDefaultHost('::1')).toBe(true);
      expect(service.isDefaultHost('localhost')).toBe(true);
    });

    it('treats REDIRECT_DEFAULT_HOSTS entries as default', () => {
      process.env.REDIRECT_DEFAULT_HOSTS = 'staging.linkiq.com, qa.linkiq.com';
      expect(service.isDefaultHost('staging.linkiq.com')).toBe(true);
      expect(service.isDefaultHost('qa.linkiq.com')).toBe(true);
    });

    it('does not treat an arbitrary hostname as default', () => {
      expect(service.isDefaultHost('go.acme.com')).toBe(false);
    });
  });

  describe('resolveHost', () => {
    it('resolves an absent Host header as default', async () => {
      await expect(service.resolveHost(undefined)).resolves.toEqual({
        kind: 'default',
      });
      expect(cache.get).not.toHaveBeenCalled();
    });

    it('resolves the default host without touching the cache or DB', async () => {
      await expect(service.resolveHost('localhost:4000')).resolves.toEqual({
        kind: 'default',
      });
      expect(cache.get).not.toHaveBeenCalled();
      expect(prisma.customDomain.findUnique).not.toHaveBeenCalled();
    });

    it('returns unknown and negatively caches a host with no matching domain', async () => {
      cache.get.mockResolvedValue(undefined);
      prisma.customDomain.findUnique.mockResolvedValue(null);

      const result = await service.resolveHost('go.acme.com');

      expect(result).toEqual({ kind: 'unknown' });
      expect(cache.setNotFound).toHaveBeenCalledWith('go.acme.com');
    });

    it('returns unknown for a domain that is not ACTIVE', async () => {
      cache.get.mockResolvedValue(undefined);
      prisma.customDomain.findUnique.mockResolvedValue({
        id: 'dom-1',
        workspaceId: 'ws-1',
        normalizedDomain: 'go.acme.com',
        status: DomainStatus.VERIFIED,
        deletedAt: null,
      });

      const result = await service.resolveHost('go.acme.com');

      expect(result).toEqual({ kind: 'unknown' });
    });

    it('returns unknown for a soft-deleted domain', async () => {
      cache.get.mockResolvedValue(undefined);
      prisma.customDomain.findUnique.mockResolvedValue({
        id: 'dom-1',
        workspaceId: 'ws-1',
        normalizedDomain: 'go.acme.com',
        status: DomainStatus.ACTIVE,
        deletedAt: new Date(),
      });

      const result = await service.resolveHost('go.acme.com');

      expect(result).toEqual({ kind: 'unknown' });
    });

    it('resolves an ACTIVE domain from the database and populates the cache', async () => {
      cache.get.mockResolvedValue(undefined);
      prisma.customDomain.findUnique.mockResolvedValue({
        id: 'dom-1',
        workspaceId: 'ws-1',
        normalizedDomain: 'go.acme.com',
        status: DomainStatus.ACTIVE,
        deletedAt: null,
      });

      const result = await service.resolveHost('Go.Acme.com:443');

      expect(result).toEqual({
        kind: 'custom',
        domain: {
          id: 'dom-1',
          workspaceId: 'ws-1',
          normalizedDomain: 'go.acme.com',
          status: DomainStatus.ACTIVE,
        },
      });
      expect(prisma.customDomain.findUnique).toHaveBeenCalledWith({
        where: { normalizedDomain: 'go.acme.com' },
      });
      expect(cache.set).toHaveBeenCalled();
    });

    it('resolves an ACTIVE domain from the cache without a DB read', async () => {
      cache.get.mockResolvedValue({
        id: 'dom-1',
        workspaceId: 'ws-1',
        normalizedDomain: 'go.acme.com',
        status: DomainStatus.ACTIVE,
      });

      const result = await service.resolveHost('go.acme.com');

      expect(result.kind).toBe('custom');
      expect(prisma.customDomain.findUnique).not.toHaveBeenCalled();
    });

    it('returns unknown for a negatively-cached host without a DB read', async () => {
      cache.get.mockResolvedValue(null);

      const result = await service.resolveHost('go.acme.com');

      expect(result).toEqual({ kind: 'unknown' });
      expect(prisma.customDomain.findUnique).not.toHaveBeenCalled();
    });
  });
});
