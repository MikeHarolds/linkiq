import { NotFoundException } from '@nestjs/common';
import { LandingPageNavPlacement, LandingPageSectionKey } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';

import { LandingPageService } from './landing-page.service';

const ctx: RequestContext = { ipAddress: '127.0.0.1', userAgent: 'jest' };

function makeFeature(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'feature-1',
    title: 'Fast redirects',
    description: 'Sub-100ms edge redirects',
    icon: 'Zap',
    sortOrder: 0,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeSection(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'section-1',
    key: LandingPageSectionKey.HERO,
    isActive: true,
    eyebrow: 'Platform',
    headline: 'Ship links that convert',
    description: 'Do more with your links',
    primaryCtaText: 'Get started',
    primaryCtaUrl: '/register',
    secondaryCtaText: null,
    secondaryCtaUrl: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('LandingPageService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let service: LandingPageService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new LandingPageService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  });

  describe('getAdminContent', () => {
    it('returns every row regardless of active state', async () => {
      prisma.landingPageSection.findMany.mockResolvedValue([makeSection({ isActive: false })]);
      prisma.landingPageFeature.findMany.mockResolvedValue([makeFeature({ isActive: false })]);
      prisma.landingPageFaq.findMany.mockResolvedValue([]);
      prisma.landingPageStat.findMany.mockResolvedValue([]);
      prisma.landingPageNavItem.findMany.mockResolvedValue([]);

      const result = await service.getAdminContent();

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]?.isActive).toBe(false);
      expect(result.features[0]?.isActive).toBe(false);
    });
  });

  describe('updateSection', () => {
    it('upserts by key, invalidates the cache, and records an audit entry', async () => {
      prisma.landingPageSection.upsert.mockResolvedValue(makeSection({ headline: 'New headline' }));

      const result = await service.updateSection(
        LandingPageSectionKey.HERO,
        { headline: 'New headline' },
        'admin-1',
        ctx,
      );

      expect(result.headline).toBe('New headline');
      expect(prisma.landingPageSection.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: LandingPageSectionKey.HERO } }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.landing_page_section_updated', userId: 'admin-1' }),
      );
    });
  });

  describe('createFeature', () => {
    it('appends the new feature at the end of the existing sort order', async () => {
      prisma.landingPageFeature.aggregate.mockResolvedValue({ _max: { sortOrder: 3 } });
      prisma.landingPageFeature.create.mockResolvedValue(makeFeature({ sortOrder: 4 }));

      const result = await service.createFeature(
        { title: 'Fast redirects', description: 'Sub-100ms edge redirects', icon: 'Zap' },
        'admin-1',
        ctx,
      );

      expect(result.sortOrder).toBe(4);
      expect(prisma.landingPageFeature.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sortOrder: 4 }),
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.landing_page_feature_created' }),
      );
    });

    it('starts sort order at 0 when no features exist yet', async () => {
      prisma.landingPageFeature.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
      prisma.landingPageFeature.create.mockResolvedValue(makeFeature({ sortOrder: 0 }));

      await service.createFeature(
        { title: 'Fast redirects', description: 'Sub-100ms edge redirects', icon: 'Zap' },
        'admin-1',
        ctx,
      );

      expect(prisma.landingPageFeature.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sortOrder: 0 }),
      });
    });
  });

  describe('updateFeature', () => {
    it('supports deactivating a feature without deleting it', async () => {
      prisma.landingPageFeature.findUnique.mockResolvedValue(makeFeature());
      prisma.landingPageFeature.update.mockResolvedValue(makeFeature({ isActive: false }));

      const result = await service.updateFeature('feature-1', { isActive: false }, 'admin-1', ctx);

      expect(result.isActive).toBe(false);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.landing_page_feature_updated' }),
      );
    });

    it('throws NotFoundException for a missing feature', async () => {
      prisma.landingPageFeature.findUnique.mockResolvedValue(null);

      await expect(service.updateFeature('missing', { isActive: false }, 'admin-1', ctx)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.landingPageFeature.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteFeature', () => {
    it('deletes an existing feature and records an audit entry', async () => {
      prisma.landingPageFeature.findUnique.mockResolvedValue(makeFeature());
      prisma.landingPageFeature.delete.mockResolvedValue(makeFeature());

      await service.deleteFeature('feature-1', 'admin-1', ctx);

      expect(prisma.landingPageFeature.delete).toHaveBeenCalledWith({ where: { id: 'feature-1' } });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.landing_page_feature_deleted' }),
      );
    });

    it('throws NotFoundException for a missing feature and never deletes', async () => {
      prisma.landingPageFeature.findUnique.mockResolvedValue(null);

      await expect(service.deleteFeature('missing', 'admin-1', ctx)).rejects.toThrow(NotFoundException);
      expect(prisma.landingPageFeature.delete).not.toHaveBeenCalled();
    });
  });

  describe('reorderFeatures', () => {
    it('reassigns sequential sortOrder values in the given order', async () => {
      await service.reorderFeatures(['f3', 'f1', 'f2'], 'admin-1', ctx);

      expect(prisma.landingPageFeature.updateMany).toHaveBeenCalledTimes(3);
      expect(prisma.landingPageFeature.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: 'f3' },
        data: { sortOrder: 0 },
      });
      expect(prisma.landingPageFeature.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: 'f1' },
        data: { sortOrder: 1 },
      });
      expect(prisma.landingPageFeature.updateMany).toHaveBeenNthCalledWith(3, {
        where: { id: 'f2' },
        data: { sortOrder: 2 },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.landing_page_feature_reordered' }),
      );
    });
  });

  describe('getPublicContent', () => {
    it('returns only active content and strips admin-only fields', async () => {
      prisma.landingPageSection.findMany.mockResolvedValue([makeSection()]);
      prisma.landingPageFeature.findMany.mockResolvedValue([makeFeature()]);
      prisma.landingPageFaq.findMany.mockResolvedValue([]);
      prisma.landingPageStat.findMany.mockResolvedValue([]);
      prisma.landingPageNavItem.findMany.mockResolvedValue([
        {
          id: 'nav-1',
          placement: LandingPageNavPlacement.HEADER,
          label: 'Pricing',
          url: '#pricing',
          sortOrder: 0,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.getPublicContent();

      expect(result.sections[0]).not.toHaveProperty('id');
      expect(result.sections[0]).not.toHaveProperty('isActive');
      expect(result.features[0]).toEqual({
        title: 'Fast redirects',
        description: 'Sub-100ms edge redirects',
        icon: 'Zap',
      });
      expect(result.navItems.header).toEqual([{ label: 'Pricing', url: '#pricing' }]);
      expect(result.navItems.footerProduct).toEqual([]);

      expect(prisma.landingPageSection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('serves from the in-memory cache on a second call within the TTL, without re-querying', async () => {
      prisma.landingPageSection.findMany.mockResolvedValue([]);
      prisma.landingPageFeature.findMany.mockResolvedValue([]);
      prisma.landingPageFaq.findMany.mockResolvedValue([]);
      prisma.landingPageStat.findMany.mockResolvedValue([]);
      prisma.landingPageNavItem.findMany.mockResolvedValue([]);

      await service.getPublicContent();
      await service.getPublicContent();

      expect(prisma.landingPageSection.findMany).toHaveBeenCalledTimes(1);
    });

    it('bypasses the cache immediately after an admin mutation', async () => {
      prisma.landingPageSection.findMany.mockResolvedValue([]);
      prisma.landingPageFeature.findMany.mockResolvedValue([]);
      prisma.landingPageFaq.findMany.mockResolvedValue([]);
      prisma.landingPageStat.findMany.mockResolvedValue([]);
      prisma.landingPageNavItem.findMany.mockResolvedValue([]);
      prisma.landingPageFeature.aggregate.mockResolvedValue({ _max: { sortOrder: null } });
      prisma.landingPageFeature.create.mockResolvedValue(makeFeature());

      await service.getPublicContent();
      await service.createFeature(
        { title: 'Fast redirects', description: 'Sub-100ms edge redirects', icon: 'Zap' },
        'admin-1',
        ctx,
      );
      await service.getPublicContent();

      expect(prisma.landingPageSection.findMany).toHaveBeenCalledTimes(2);
    });

    it('does not crash when there is no active content at all', async () => {
      prisma.landingPageSection.findMany.mockResolvedValue([]);
      prisma.landingPageFeature.findMany.mockResolvedValue([]);
      prisma.landingPageFaq.findMany.mockResolvedValue([]);
      prisma.landingPageStat.findMany.mockResolvedValue([]);
      prisma.landingPageNavItem.findMany.mockResolvedValue([]);

      const result = await service.getPublicContent();

      expect(result).toEqual({
        sections: [],
        features: [],
        faqs: [],
        stats: [],
        navItems: { header: [], footerProduct: [], footerDevelopers: [], footerCompany: [] },
      });
    });
  });
});
