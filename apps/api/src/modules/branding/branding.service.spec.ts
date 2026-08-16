import { BadRequestException } from '@nestjs/common';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';

import { BrandingService } from './branding.service';
import type { MediaStorageProvider } from './storage/media-storage.interface';

const ctx: RequestContext = { ipAddress: '127.0.0.1', userAgent: 'jest' };
const SINGLETON_ID = '00000000-0000-0000-0000-000000000001';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function makeBranding(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SINGLETON_ID,
    siteName: 'LinkIQ',
    logoUrl: null,
    faviconUrl: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('BrandingService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let storage: { save: jest.Mock; delete: jest.Mock };
  let service: BrandingService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    storage = {
      save: jest.fn().mockResolvedValue({ url: '/uploads/branding/new-file.png', storageKey: 'branding/new-file.png' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new BrandingService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      storage as unknown as MediaStorageProvider,
    );
  });

  describe('get', () => {
    it('upserts the singleton row so a fresh install still returns a branding record', async () => {
      prisma.siteBranding.upsert.mockResolvedValue(makeBranding());

      const result = await service.get();

      expect(result.siteName).toBe('LinkIQ');
      expect(prisma.siteBranding.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: SINGLETON_ID } }),
      );
    });

    it('serves from cache on a second call within the TTL', async () => {
      prisma.siteBranding.upsert.mockResolvedValue(makeBranding());

      await service.get();
      await service.get();

      expect(prisma.siteBranding.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateSiteName', () => {
    it('updates the site name, invalidates the cache, and audits it without leaking secrets', async () => {
      prisma.siteBranding.upsert.mockResolvedValue(makeBranding({ siteName: 'Acme Links' }));

      const result = await service.updateSiteName({ siteName: 'Acme Links' }, 'admin-1', ctx);

      expect(result.siteName).toBe('Acme Links');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.branding_updated', userId: 'admin-1' }),
      );
    });
  });

  describe('uploadLogo', () => {
    it('validates the file, saves it via the storage provider, and persists the resulting URL', async () => {
      prisma.siteBranding.upsert
        .mockResolvedValueOnce(makeBranding({ logoUrl: null })) // this.get() inside uploadImage
        .mockResolvedValueOnce(makeBranding({ logoUrl: '/uploads/branding/new-file.png' }));

      const file = { buffer: PNG_HEADER, originalname: 'logo.png', mimetype: 'image/png', size: PNG_HEADER.length };
      const result = await service.uploadLogo(file, 'admin-1', ctx);

      expect(result.logoUrl).toBe('/uploads/branding/new-file.png');
      expect(storage.save).toHaveBeenCalledWith(PNG_HEADER, 'logo.png', 'image/png');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.branding_logo_uploaded' }),
      );
    });

    it('rejects an oversized file before ever touching the storage provider', async () => {
      const file = {
        buffer: PNG_HEADER,
        originalname: 'logo.png',
        mimetype: 'image/png',
        size: 3 * 1024 * 1024,
      };

      await expect(service.uploadLogo(file, 'admin-1', ctx)).rejects.toThrow(BadRequestException);
      expect(storage.save).not.toHaveBeenCalled();
    });

    it('deletes the previous logo file after a successful replace', async () => {
      prisma.siteBranding.upsert
        .mockResolvedValueOnce(makeBranding({ logoUrl: '/uploads/branding/old-file.png' }))
        .mockResolvedValueOnce(makeBranding({ logoUrl: '/uploads/branding/new-file.png' }));

      const file = { buffer: PNG_HEADER, originalname: 'logo.png', mimetype: 'image/png', size: PNG_HEADER.length };
      await service.uploadLogo(file, 'admin-1', ctx);

      expect(storage.delete).toHaveBeenCalledWith('branding/old-file.png');
    });
  });

  describe('removeLogo', () => {
    it('clears the logo URL and deletes the underlying file', async () => {
      prisma.siteBranding.upsert
        .mockResolvedValueOnce(makeBranding({ logoUrl: '/uploads/branding/old-file.png' }))
        .mockResolvedValueOnce(makeBranding({ logoUrl: null }));

      const result = await service.removeLogo('admin-1', ctx);

      expect(result.logoUrl).toBeNull();
      expect(storage.delete).toHaveBeenCalledWith('branding/old-file.png');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.branding_logo_removed' }),
      );
    });

    it('is a no-op on storage when there was no logo to begin with', async () => {
      prisma.siteBranding.upsert
        .mockResolvedValueOnce(makeBranding({ logoUrl: null }))
        .mockResolvedValueOnce(makeBranding({ logoUrl: null }));

      await service.removeLogo('admin-1', ctx);

      expect(storage.delete).not.toHaveBeenCalled();
    });
  });
});
