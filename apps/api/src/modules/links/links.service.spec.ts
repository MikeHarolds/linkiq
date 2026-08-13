import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { LinkStatus } from '@prisma/client';

import { makeUniqueConstraintError } from '../../../test/mocks/prisma-error.mock';
import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { AuditService } from '../audit/audit.service';
import type { BillingUsageService } from '../billing/billing-usage.service';
import type { DomainsService } from '../domains/domains.service';
import { PublicUrlService } from '../domains/public-url.service';
import type { WebhookEventsService } from '../webhooks/webhook-events.service';

import type { LinkCacheService } from './link-cache.service';
import { LinksService } from './links.service';

const ACTIVE = 'ACTIVE' as LinkStatus;
const PAUSED = 'PAUSED' as LinkStatus;
const ARCHIVED = 'ARCHIVED' as LinkStatus;
const CTX = { ipAddress: '127.0.0.1', userAgent: 'jest' };
const WORKSPACE_ID = 'ws-1';
const USER_ID = 'user-1';

function makeLink(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'link-1',
    workspaceId: WORKSPACE_ID,
    createdById: USER_ID,
    destinationUrl: 'https://example.com',
    shortCode: 'abc1234',
    title: null,
    description: null,
    status: ACTIVE,
    isActive: true,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('LinksService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let cache: { invalidate: jest.Mock };
  let domains: { findSelectableOrThrow: jest.Mock };
  let billingUsage: { assertCanUse: jest.Mock };
  let webhookEvents: { emit: jest.Mock };
  let service: LinksService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    cache = { invalidate: jest.fn().mockResolvedValue(undefined) };
    // Not exercised by any test below (none pass customDomainId) —
    // present so the constructor has a valid 4th argument.
    domains = { findSelectableOrThrow: jest.fn() };
    // Defaults to "always allowed" — matches every existing test below,
    // which expects Sprint 0-6 create behavior completely unaffected by
    // Sprint 7's limit enforcement unless a test explicitly overrides it.
    billingUsage = { assertCanUse: jest.fn().mockResolvedValue(undefined) };
    webhookEvents = { emit: jest.fn().mockResolvedValue(undefined) };
    service = new LinksService(
      prisma as unknown as never,
      audit as unknown as AuditService,
      cache as unknown as LinkCacheService,
      domains as unknown as DomainsService,
      new PublicUrlService(),
      billingUsage as unknown as BillingUsageService,
      webhookEvents as unknown as WebhookEventsService,
    );
  });

  describe('create — destination URL validation', () => {
    it('rejects an invalid destination URL before touching the database', async () => {
      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          { destinationUrl: 'not-a-url' },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.link.create).not.toHaveBeenCalled();
    });

    it('rejects a dangerous scheme', async () => {
      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          { destinationUrl: 'javascript:alert(1)' },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects expiresAt in the past', async () => {
      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          {
            destinationUrl: 'https://example.com',
            expiresAt: '2020-01-01T00:00:00.000Z',
          },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('create — plan limits (Sprint 7)', () => {
    it('rejects creation when the workspace has reached its link limit', async () => {
      billingUsage.assertCanUse.mockRejectedValue(
        new Error('PLAN_LIMIT_REACHED'),
      );

      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          { destinationUrl: 'https://example.com' },
          CTX,
        ),
      ).rejects.toThrow('PLAN_LIMIT_REACHED');
      expect(prisma.link.create).not.toHaveBeenCalled();
    });

    it('checks the MAX_LINKS limit for the creating workspace', async () => {
      prisma.link.create.mockResolvedValue(makeLink());

      await service.create(
        WORKSPACE_ID,
        USER_ID,
        { destinationUrl: 'https://example.com' },
        CTX,
      );

      expect(billingUsage.assertCanUse).toHaveBeenCalledWith(
        WORKSPACE_ID,
        'MAX_LINKS',
        'links',
        1,
      );
    });
  });

  describe('create — automatic short code generation', () => {
    it('creates a link with a generated shortCode when no slug is given', async () => {
      prisma.link.create.mockResolvedValue(makeLink());

      const result = await service.create(
        WORKSPACE_ID,
        USER_ID,
        { destinationUrl: 'https://example.com' },
        CTX,
      );

      expect(prisma.link.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.link.create.mock.calls[0][0];
      expect(createArgs.data.shortCode).toMatch(/^[A-Za-z0-9]{7}$/);
      expect(result.shortCode).toBeDefined();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'link.created' }),
      );
    });

    it('retries with a new code on a unique-constraint collision', async () => {
      const collision = makeUniqueConstraintError();
      prisma.link.create
        .mockRejectedValueOnce(collision)
        .mockResolvedValueOnce(makeLink());

      const result = await service.create(
        WORKSPACE_ID,
        USER_ID,
        { destinationUrl: 'https://example.com' },
        CTX,
      );

      expect(prisma.link.create).toHaveBeenCalledTimes(2);
      expect(result).toBeDefined();
    });

    it('gives up after repeated collisions rather than retrying forever', async () => {
      const collision = makeUniqueConstraintError();
      prisma.link.create.mockRejectedValue(collision);

      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          { destinationUrl: 'https://example.com' },
          CTX,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('propagates non-collision errors instead of retrying', async () => {
      prisma.link.create.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          { destinationUrl: 'https://example.com' },
          CTX,
        ),
      ).rejects.toThrow('connection lost');
      expect(prisma.link.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('create — custom slug', () => {
    it('creates a link with the given slug', async () => {
      prisma.link.create.mockResolvedValue(makeLink({ shortCode: 'my-slug' }));

      const result = await service.create(
        WORKSPACE_ID,
        USER_ID,
        { destinationUrl: 'https://example.com', slug: 'my-slug' },
        CTX,
      );

      expect(prisma.link.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shortCode: 'my-slug' }),
        }),
      );
      expect(result.shortCode).toBe('my-slug');
    });

    it('rejects a reserved slug', async () => {
      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          { destinationUrl: 'https://example.com', slug: 'admin' },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.link.create).not.toHaveBeenCalled();
    });

    it('rejects an invalid slug (bad characters)', async () => {
      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          { destinationUrl: 'https://example.com', slug: 'has spaces' },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('surfaces a duplicate custom slug as 409 Conflict, not a retry', async () => {
      const collision = makeUniqueConstraintError();
      prisma.link.create.mockRejectedValue(collision);

      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          { destinationUrl: 'https://example.com', slug: 'taken-slug' },
          CTX,
        ),
      ).rejects.toThrow(ConflictException);
      // Custom slugs never retry with a different code — the user asked
      // for this exact slug; silently substituting one would be wrong.
      expect(prisma.link.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('findByIdOrThrow — workspace isolation', () => {
    it('throws NotFoundException when the link does not exist', async () => {
      prisma.link.findUnique.mockResolvedValue(null);
      await expect(
        service.findByIdOrThrow(WORKSPACE_ID, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException (not ForbiddenException) for a link in another workspace', async () => {
      prisma.link.findUnique.mockResolvedValue(
        makeLink({ workspaceId: 'other-workspace' }),
      );
      await expect(
        service.findByIdOrThrow(WORKSPACE_ID, 'link-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for a soft-deleted link', async () => {
      prisma.link.findUnique.mockResolvedValue(
        makeLink({ deletedAt: new Date() }),
      );
      await expect(
        service.findByIdOrThrow(WORKSPACE_ID, 'link-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the link when it belongs to the workspace', async () => {
      const link = makeLink();
      prisma.link.findUnique.mockResolvedValue(link);
      await expect(
        service.findByIdOrThrow(WORKSPACE_ID, 'link-1'),
      ).resolves.toMatchObject(link);
    });
  });

  describe('transitionStatus — lifecycle', () => {
    it('pauses an active link and sets isActive false', async () => {
      prisma.link.findUnique.mockResolvedValue(makeLink({ status: ACTIVE }));
      prisma.link.update.mockResolvedValue(
        makeLink({ status: PAUSED, isActive: false }),
      );

      await service.transitionStatus(
        WORKSPACE_ID,
        'link-1',
        USER_ID,
        PAUSED,
        CTX,
      );

      expect(prisma.link.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { status: PAUSED, isActive: false },
        include: { customDomain: true },
      });
      expect(cache.invalidate).toHaveBeenCalledWith('abc1234');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'link.paused' }),
      );
    });

    it('reactivates a paused link and sets isActive true', async () => {
      prisma.link.findUnique.mockResolvedValue(
        makeLink({ status: PAUSED, isActive: false }),
      );
      prisma.link.update.mockResolvedValue(
        makeLink({ status: ACTIVE, isActive: true }),
      );

      await service.transitionStatus(
        WORKSPACE_ID,
        'link-1',
        USER_ID,
        ACTIVE,
        CTX,
      );

      expect(prisma.link.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { status: ACTIVE, isActive: true },
        include: { customDomain: true },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'link.activated' }),
      );
    });

    it('reactivates an archived link (eligible reactivation)', async () => {
      prisma.link.findUnique.mockResolvedValue(
        makeLink({ status: ARCHIVED, isActive: false }),
      );
      prisma.link.update.mockResolvedValue(
        makeLink({ status: ACTIVE, isActive: true }),
      );

      await expect(
        service.transitionStatus(WORKSPACE_ID, 'link-1', USER_ID, ACTIVE, CTX),
      ).resolves.toBeDefined();
    });

    it('archives a link', async () => {
      prisma.link.findUnique.mockResolvedValue(makeLink({ status: ACTIVE }));
      prisma.link.update.mockResolvedValue(
        makeLink({ status: ARCHIVED, isActive: false }),
      );

      await service.transitionStatus(
        WORKSPACE_ID,
        'link-1',
        USER_ID,
        ARCHIVED,
        CTX,
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'link.archived' }),
      );
    });

    it('rejects a same-state transition', async () => {
      prisma.link.findUnique.mockResolvedValue(makeLink({ status: PAUSED }));

      await expect(
        service.transitionStatus(WORKSPACE_ID, 'link-1', USER_ID, PAUSED, CTX),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.link.update).not.toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt and isActive false, invalidates cache, and audits', async () => {
      prisma.link.findUnique.mockResolvedValue(makeLink());
      prisma.link.update.mockResolvedValue(makeLink({ deletedAt: new Date() }));

      await service.softDelete(WORKSPACE_ID, 'link-1', USER_ID, CTX);

      expect(prisma.link.update).toHaveBeenCalledWith({
        where: { id: 'link-1' },
        data: { deletedAt: expect.any(Date), isActive: false },
      });
      expect(cache.invalidate).toHaveBeenCalledWith('abc1234');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'link.deleted' }),
      );
    });
  });

  describe('isEffectivelyExpired', () => {
    it('returns true for an ACTIVE link with a past expiresAt', () => {
      expect(
        service.isEffectivelyExpired({
          status: ACTIVE,
          expiresAt: new Date(Date.now() - 1000),
        }),
      ).toBe(true);
    });

    it('returns false for an ACTIVE link with a future expiresAt', () => {
      expect(
        service.isEffectivelyExpired({
          status: ACTIVE,
          expiresAt: new Date(Date.now() + 100000),
        }),
      ).toBe(false);
    });

    it('returns false for an ACTIVE link with no expiresAt', () => {
      expect(
        service.isEffectivelyExpired({ status: ACTIVE, expiresAt: null }),
      ).toBe(false);
    });

    it('returns false for a PAUSED link even with a past expiresAt (status already blocks it)', () => {
      expect(
        service.isEffectivelyExpired({
          status: PAUSED,
          expiresAt: new Date(Date.now() - 1000),
        }),
      ).toBe(false);
    });
  });

  describe('campaign / UTM integration (Sprint 5)', () => {
    function makeCampaign(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        id: 'campaign-1',
        workspaceId: WORKSPACE_ID,
        name: 'Test Campaign',
        status: 'ACTIVE',
        utmSource: 'newsletter',
        utmMedium: 'email',
        utmCampaign: 'campaign_default',
        utmTerm: null,
        utmContent: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      };
    }

    it('rejects a campaignId for a campaign that does not exist', async () => {
      prisma.campaign.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          { destinationUrl: 'https://example.com', campaignId: 'campaign-1' },
          CTX,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.link.create).not.toHaveBeenCalled();
    });

    it('rejects a campaignId belonging to another workspace (404, not 403)', async () => {
      prisma.campaign.findUnique.mockResolvedValue(
        makeCampaign({ workspaceId: 'other-ws' }),
      );

      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          { destinationUrl: 'https://example.com', campaignId: 'campaign-1' },
          CTX,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('inherits UTM defaults from the campaign when no overrides are given', async () => {
      prisma.campaign.findUnique.mockResolvedValue(makeCampaign());
      prisma.link.create.mockResolvedValue(makeLink());

      await service.create(
        WORKSPACE_ID,
        USER_ID,
        { destinationUrl: 'https://example.com', campaignId: 'campaign-1' },
        CTX,
      );

      const createArgs = prisma.link.create.mock.calls[0][0];
      expect(createArgs.data.utmSource).toBe('newsletter');
      expect(createArgs.data.utmMedium).toBe('email');
      expect(createArgs.data.utmCampaign).toBe('campaign_default');
      expect(createArgs.data.campaignId).toBe('campaign-1');
    });

    it('lets an explicit UTM override win over the campaign default', async () => {
      prisma.campaign.findUnique.mockResolvedValue(makeCampaign());
      prisma.link.create.mockResolvedValue(makeLink());

      await service.create(
        WORKSPACE_ID,
        USER_ID,
        {
          destinationUrl: 'https://example.com',
          campaignId: 'campaign-1',
          utmSource: 'facebook',
        },
        CTX,
      );

      const createArgs = prisma.link.create.mock.calls[0][0];
      expect(createArgs.data.utmSource).toBe('facebook'); // override, not 'newsletter'
      expect(createArgs.data.utmMedium).toBe('email'); // still inherited
    });

    it('creates a link with explicit UTM values and no campaign at all', async () => {
      prisma.link.create.mockResolvedValue(makeLink());

      await service.create(
        WORKSPACE_ID,
        USER_ID,
        {
          destinationUrl: 'https://example.com',
          utmSource: 'facebook',
          utmMedium: 'cpc',
        },
        CTX,
      );

      expect(prisma.campaign.findUnique).not.toHaveBeenCalled();
      const createArgs = prisma.link.create.mock.calls[0][0];
      expect(createArgs.data.utmSource).toBe('facebook');
      expect(createArgs.data.campaignId).toBeUndefined();
    });

    it('rejects an invalid UTM value at creation', async () => {
      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          {
            destinationUrl: 'https://example.com',
            utmSource: '<script>bad</script>',
          },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.link.create).not.toHaveBeenCalled();
    });

    describe('update', () => {
      it('reassigns a link to a new campaign, inheriting its UTM defaults for untouched fields', async () => {
        prisma.link.findUnique.mockResolvedValue(
          makeLink({ campaignId: null }),
        );
        prisma.campaign.findUnique.mockResolvedValue(makeCampaign());
        prisma.link.update.mockResolvedValue(
          makeLink({ campaignId: 'campaign-1' }),
        );

        await service.update(
          WORKSPACE_ID,
          'link-1',
          USER_ID,
          { campaignId: 'campaign-1' },
          CTX,
        );

        const updateArgs = prisma.link.update.mock.calls[0][0];
        expect(updateArgs.data.campaignId).toBe('campaign-1');
        expect(updateArgs.data.utmSource).toBe('newsletter');
      });

      it('clears the campaign association and UTM fields when campaignId is set to null', async () => {
        prisma.link.findUnique.mockResolvedValue(
          makeLink({ campaignId: 'campaign-1', utmSource: 'newsletter' }),
        );
        prisma.link.update.mockResolvedValue(makeLink({ campaignId: null }));

        await service.update(
          WORKSPACE_ID,
          'link-1',
          USER_ID,
          { campaignId: null },
          CTX,
        );

        const updateArgs = prisma.link.update.mock.calls[0][0];
        expect(updateArgs.data.campaignId).toBeNull();
        expect(updateArgs.data.utmSource).toBeUndefined();
        expect(prisma.campaign.findUnique).not.toHaveBeenCalled();
      });

      it('an explicit null UTM field wins over the new campaign default (explicit clear beats inheritance)', async () => {
        prisma.link.findUnique.mockResolvedValue(
          makeLink({ campaignId: null }),
        );
        prisma.campaign.findUnique.mockResolvedValue(makeCampaign());
        prisma.link.update.mockResolvedValue(makeLink());

        await service.update(
          WORKSPACE_ID,
          'link-1',
          USER_ID,
          { campaignId: 'campaign-1', utmSource: null },
          CTX,
        );

        const updateArgs = prisma.link.update.mock.calls[0][0];
        expect(updateArgs.data.utmSource).toBeUndefined(); // cleared, not 'newsletter'
        expect(updateArgs.data.utmMedium).toBe('email'); // still inherited
      });

      it('updates a UTM field directly without touching campaignId or re-resolving defaults', async () => {
        prisma.link.findUnique.mockResolvedValue(
          makeLink({ campaignId: 'campaign-1' }),
        );
        prisma.link.update.mockResolvedValue(makeLink());

        await service.update(
          WORKSPACE_ID,
          'link-1',
          USER_ID,
          { utmContent: 'header-cta' },
          CTX,
        );

        expect(prisma.campaign.findUnique).not.toHaveBeenCalled();
        const updateArgs = prisma.link.update.mock.calls[0][0];
        expect(updateArgs.data.utmContent).toBe('header-cta');
        expect(updateArgs.data.campaignId).toBeUndefined();
      });

      it('rejects an invalid UTM value on update', async () => {
        prisma.link.findUnique.mockResolvedValue(makeLink());

        await expect(
          service.update(
            WORKSPACE_ID,
            'link-1',
            USER_ID,
            { utmSource: 'a'.repeat(300) },
            CTX,
          ),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.link.update).not.toHaveBeenCalled();
      });
    });
  });
});
