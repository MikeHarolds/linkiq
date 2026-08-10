import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';

import type { LinkCacheService } from './link-cache.service';
import type { ClickEventProducer } from './queue/click-event.producer';
import { RedirectService } from './redirect.service';

function makeCachedLink(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'link-1',
    workspaceId: 'ws-1',
    destinationUrl: 'https://example.com',
    status: 'ACTIVE',
    isActive: true,
    expiresAt: null,
    ...overrides,
  };
}

describe('RedirectService', () => {
  let prisma: MockPrismaService;
  let cache: { get: jest.Mock; set: jest.Mock; setNotFound: jest.Mock };
  let clickEvents: { enqueue: jest.Mock };
  let service: RedirectService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    cache = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      setNotFound: jest.fn().mockResolvedValue(undefined),
    };
    clickEvents = { enqueue: jest.fn() };
    service = new RedirectService(
      prisma as unknown as never,
      cache as unknown as LinkCacheService,
      clickEvents as unknown as ClickEventProducer,
    );
  });

  describe('cache hit', () => {
    it('redirects using the cached entry without touching the database', async () => {
      cache.get.mockResolvedValue(makeCachedLink());

      const outcome = await service.resolve('abc123', {});

      expect(outcome).toEqual({
        kind: 'redirect',
        destinationUrl: 'https://example.com',
      });
      expect(prisma.link.findUnique).not.toHaveBeenCalled();
    });

    it('enqueues a click event on a successful cached redirect', async () => {
      cache.get.mockResolvedValue(makeCachedLink());

      await service.resolve('abc123', {
        ipAddress: '1.2.3.4',
        userAgent: 'test-agent',
      });

      expect(clickEvents.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          linkId: 'link-1',
          workspaceId: 'ws-1',
          ipAddress: '1.2.3.4',
          userAgent: 'test-agent',
        }),
      );
    });

    it('returns not_found for a negatively-cached entry, without a DB read', async () => {
      cache.get.mockResolvedValue(null);

      const outcome = await service.resolve('missing', {});

      expect(outcome).toEqual({ kind: 'not_found' });
      expect(prisma.link.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('cache miss -> database fallback', () => {
    it('falls back to the database and populates the cache on success', async () => {
      cache.get.mockResolvedValue(undefined);
      const dbLink = {
        id: 'link-1',
        workspaceId: 'ws-1',
        destinationUrl: 'https://example.com',
        status: 'ACTIVE',
        isActive: true,
        expiresAt: null,
        deletedAt: null,
      };
      prisma.link.findUnique.mockResolvedValue(dbLink);

      const outcome = await service.resolve('abc123', {});

      expect(outcome).toEqual({
        kind: 'redirect',
        destinationUrl: 'https://example.com',
      });
      expect(prisma.link.findUnique).toHaveBeenCalledWith({
        where: { shortCode: 'abc123' },
      });
      expect(cache.set).toHaveBeenCalledWith('abc123', dbLink);
    });

    it('negatively caches an unknown short code on DB miss', async () => {
      cache.get.mockResolvedValue(undefined);
      prisma.link.findUnique.mockResolvedValue(null);

      const outcome = await service.resolve('unknown', {});

      expect(outcome).toEqual({ kind: 'not_found' });
      expect(cache.setNotFound).toHaveBeenCalledWith('unknown');
    });

    it('treats a soft-deleted link as not found', async () => {
      cache.get.mockResolvedValue(undefined);
      prisma.link.findUnique.mockResolvedValue({
        id: 'link-1',
        deletedAt: new Date(),
        status: 'ACTIVE',
        isActive: true,
        expiresAt: null,
        destinationUrl: 'https://example.com',
        workspaceId: 'ws-1',
      });

      const outcome = await service.resolve('deleted-code', {});

      expect(outcome).toEqual({ kind: 'not_found' });
      expect(cache.setNotFound).toHaveBeenCalledWith('deleted-code');
    });
  });

  describe('UTM application (Sprint 5)', () => {
    it('applies UTM params onto the destination when the link has UTM configured', async () => {
      cache.get.mockResolvedValue(
        makeCachedLink({
          destinationUrl: 'https://example.com/product?id=123',
          utmSource: 'facebook',
          utmMedium: 'social',
        }),
      );

      const outcome = await service.resolve('code', {});

      expect(outcome).toEqual({
        kind: 'redirect',
        destinationUrl:
          'https://example.com/product?id=123&utm_source=facebook&utm_medium=social',
      });
    });

    it('returns the raw destination unchanged when the link has no UTM configuration', async () => {
      cache.get.mockResolvedValue(makeCachedLink());

      const outcome = await service.resolve('code', {});

      expect(outcome).toEqual({
        kind: 'redirect',
        destinationUrl: 'https://example.com',
      });
    });

    it('falls back to the raw destination (redirect still succeeds) if UTM application throws', async () => {
      cache.get.mockResolvedValue(
        makeCachedLink({
          destinationUrl: 'not actually a valid url',
          utmSource: 'x',
        }),
      );

      const outcome = await service.resolve('code', {});

      expect(outcome).toEqual({
        kind: 'redirect',
        destinationUrl: 'not actually a valid url',
      });
    });

    it('applies UTM params when resolving from the database on a cache miss', async () => {
      cache.get.mockResolvedValue(undefined);
      prisma.link.findUnique.mockResolvedValue({
        id: 'link-1',
        workspaceId: 'ws-1',
        destinationUrl: 'https://example.com',
        status: 'ACTIVE',
        isActive: true,
        expiresAt: null,
        deletedAt: null,
        utmSource: 'newsletter',
        utmMedium: null,
        utmCampaign: null,
        utmTerm: null,
        utmContent: null,
      });

      const outcome = await service.resolve('code', {});

      expect(outcome).toEqual({
        kind: 'redirect',
        destinationUrl: 'https://example.com/?utm_source=newsletter',
      });
    });
  });

  describe('link state validation', () => {
    it('blocks a paused link', async () => {
      cache.get.mockResolvedValue(
        makeCachedLink({ status: 'PAUSED', isActive: false }),
      );
      const outcome = await service.resolve('code', {});
      expect(outcome).toEqual({ kind: 'paused' });
      expect(clickEvents.enqueue).not.toHaveBeenCalled();
    });

    it('blocks an archived link', async () => {
      cache.get.mockResolvedValue(
        makeCachedLink({ status: 'ARCHIVED', isActive: false }),
      );
      const outcome = await service.resolve('code', {});
      expect(outcome).toEqual({ kind: 'archived' });
      expect(clickEvents.enqueue).not.toHaveBeenCalled();
    });

    it('blocks an expired link even though its stored status is still ACTIVE', async () => {
      cache.get.mockResolvedValue(
        makeCachedLink({
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
      );
      const outcome = await service.resolve('code', {});
      expect(outcome).toEqual({ kind: 'expired' });
      expect(clickEvents.enqueue).not.toHaveBeenCalled();
    });

    it('allows a link with a future expiresAt', async () => {
      cache.get.mockResolvedValue(
        makeCachedLink({
          expiresAt: new Date(Date.now() + 100000).toISOString(),
        }),
      );
      const outcome = await service.resolve('code', {});
      expect(outcome.kind).toBe('redirect');
    });

    it('archived state takes precedence over an also-past expiresAt', async () => {
      cache.get.mockResolvedValue(
        makeCachedLink({
          status: 'ARCHIVED',
          isActive: false,
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
      );
      const outcome = await service.resolve('code', {});
      expect(outcome).toEqual({ kind: 'archived' });
    });
  });
});
