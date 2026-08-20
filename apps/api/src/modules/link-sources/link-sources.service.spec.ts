import { ConflictException, NotFoundException } from '@nestjs/common';

import { makeUniqueConstraintError } from '../../../test/mocks/prisma-error.mock';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { AuditService } from '../audit/audit.service';
import type { PublicUrlService } from '../domains/public-url.service';
import type { WebhookEventsService } from '../webhooks/webhook-events.service';

import { LinkSourcesService } from './link-sources.service';

const CTX = { ipAddress: '127.0.0.1', userAgent: 'jest' };
const WORKSPACE_ID = 'ws-1';
const LINK_ID = 'link-1';
const USER_ID = 'user-1';

function makeLink(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: LINK_ID,
    workspaceId: WORKSPACE_ID,
    shortCode: 'abc123',
    customDomainId: null,
    deletedAt: null,
    ...overrides,
  };
}

function makeLinkSource(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'source-1',
    workspaceId: WORKSPACE_ID,
    linkId: LINK_ID,
    name: 'WhatsApp Campaign',
    source: 'whatsapp',
    medium: 'messaging',
    campaign: null,
    isActive: true,
    createdById: USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('LinkSourcesService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let publicUrl: { build: jest.Mock };
  let webhookEvents: { emit: jest.Mock };
  let service: LinkSourcesService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    publicUrl = {
      build: jest.fn(() => 'https://linkiq-web.onrender.com/abc123'),
    };
    webhookEvents = { emit: jest.fn().mockResolvedValue(undefined) };
    service = new LinkSourcesService(
      prisma as unknown as never,
      audit as unknown as AuditService,
      publicUrl as unknown as PublicUrlService,
      webhookEvents as unknown as WebhookEventsService,
    );
    prisma.link.findUnique.mockResolvedValue(makeLink());
  });

  describe('create', () => {
    it('404s when the link does not exist in this workspace', async () => {
      prisma.link.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          WORKSPACE_ID,
          LINK_ID,
          USER_ID,
          { name: 'WhatsApp', source: 'whatsapp', medium: 'messaging' },
          CTX,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('normalizes the source key (trim + lowercase) before storing', async () => {
      prisma.linkSource.create.mockResolvedValue(
        makeLinkSource({ source: 'whatsapp' }),
      );

      await service.create(
        WORKSPACE_ID,
        LINK_ID,
        USER_ID,
        { name: 'WhatsApp', source: '  WhatsApp  ', medium: 'messaging' },
        CTX,
      );

      expect(prisma.linkSource.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: 'whatsapp' }),
        }),
      );
    });

    it('generates a tracking URL carrying utm_source/utm_medium/utm_campaign', async () => {
      prisma.linkSource.create.mockResolvedValue(
        makeLinkSource({ source: 'facebook', medium: 'social', campaign: 'summer' }),
      );

      const result = await service.create(
        WORKSPACE_ID,
        LINK_ID,
        USER_ID,
        { name: 'FB', source: 'facebook', medium: 'social', campaign: 'summer' },
        CTX,
      );

      const url = new URL(result.trackingUrl);
      expect(url.searchParams.get('utm_source')).toBe('facebook');
      expect(url.searchParams.get('utm_medium')).toBe('social');
      expect(url.searchParams.get('utm_campaign')).toBe('summer');
    });

    it('audits creation and emits LINK_SOURCE_CREATED', async () => {
      prisma.linkSource.create.mockResolvedValue(makeLinkSource());

      await service.create(
        WORKSPACE_ID,
        LINK_ID,
        USER_ID,
        { name: 'WhatsApp', source: 'whatsapp', medium: 'messaging' },
        CTX,
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'link_source.created' }),
      );
      expect(webhookEvents.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LINK_SOURCE_CREATED' }),
      );
    });

    it('converts a unique-constraint violation (duplicate active source for this link) into a 409', async () => {
      prisma.linkSource.create.mockRejectedValue(makeUniqueConstraintError());

      await expect(
        service.create(
          WORKSPACE_ID,
          LINK_ID,
          USER_ID,
          { name: 'WhatsApp', source: 'whatsapp', medium: 'messaging' },
          CTX,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findAllForLink', () => {
    it('attaches a live click count per source from clickEvent.groupBy', async () => {
      prisma.linkSource.findMany.mockResolvedValue([
        makeLinkSource({ id: 'source-1' }),
        makeLinkSource({ id: 'source-2', source: 'facebook' }),
      ]);
      prisma.clickEvent.groupBy.mockResolvedValue([
        { linkSourceId: 'source-1', _count: { _all: 7 } },
      ]);

      const result = await service.findAllForLink(WORKSPACE_ID, LINK_ID);

      expect(result.find((r) => r.id === 'source-1')?.clickCount).toBe(7);
      // No matching groupBy row — defaults to 0, not undefined/NaN.
      expect(result.find((r) => r.id === 'source-2')?.clickCount).toBe(0);
    });

    it('includes a trackingUrl for every returned source', async () => {
      prisma.linkSource.findMany.mockResolvedValue([makeLinkSource()]);
      prisma.clickEvent.groupBy.mockResolvedValue([]);

      const result = await service.findAllForLink(WORKSPACE_ID, LINK_ID);

      expect(result[0].trackingUrl).toContain('utm_source=whatsapp');
    });
  });

  describe('update', () => {
    it('404s for a source in another workspace', async () => {
      prisma.linkSource.findUnique.mockResolvedValue(
        makeLinkSource({ workspaceId: 'other-ws' }),
      );

      await expect(
        service.update(WORKSPACE_ID, 'source-1', USER_ID, { isActive: false }, CTX),
      ).rejects.toThrow(NotFoundException);
    });

    it('deactivating sets isActive: false and audits it', async () => {
      prisma.linkSource.findUnique.mockResolvedValue(makeLinkSource());
      prisma.linkSource.update.mockResolvedValue(
        makeLinkSource({ isActive: false }),
      );

      const result = await service.update(
        WORKSPACE_ID,
        'source-1',
        USER_ID,
        { isActive: false },
        CTX,
      );

      expect(prisma.linkSource.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
      expect(result.isActive).toBe(false);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'link_source.updated' }),
      );
    });

    it('re-normalizes source on update and still enforces uniqueness', async () => {
      prisma.linkSource.findUnique.mockResolvedValue(makeLinkSource());
      prisma.linkSource.update.mockRejectedValue(makeUniqueConstraintError());

      await expect(
        service.update(
          WORKSPACE_ID,
          'source-1',
          USER_ID,
          { source: 'Facebook' },
          CTX,
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt rather than removing the row, and emits LINK_SOURCE_DELETED', async () => {
      prisma.linkSource.findUnique.mockResolvedValue(makeLinkSource());
      prisma.linkSource.update.mockResolvedValue(
        makeLinkSource({ deletedAt: new Date() }),
      );

      await service.softDelete(WORKSPACE_ID, 'source-1', USER_ID, CTX);

      expect(prisma.linkSource.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      expect(webhookEvents.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LINK_SOURCE_DELETED' }),
      );
    });

    it('404s for an already-deleted source', async () => {
      prisma.linkSource.findUnique.mockResolvedValue(
        makeLinkSource({ deletedAt: new Date() }),
      );

      await expect(
        service.softDelete(WORKSPACE_ID, 'source-1', USER_ID, CTX),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
