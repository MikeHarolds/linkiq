import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CampaignStatus } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { AuditService } from '../audit/audit.service';

import { CampaignsService } from './campaigns.service';

const CTX = { ipAddress: '127.0.0.1', userAgent: 'jest' };
const WORKSPACE_ID = 'ws-1';
const USER_ID = 'user-1';

function makeCampaign(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'campaign-1',
    workspaceId: WORKSPACE_ID,
    name: 'Test Campaign',
    description: null,
    status: CampaignStatus.DRAFT,
    startDate: null,
    endDate: null,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    utmTerm: null,
    utmContent: null,
    createdById: USER_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function isUniqueViolation() {
  return Object.assign(new Error('duplicate key'), { code: '23505' });
}

describe('CampaignsService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let service: CampaignsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new CampaignsService(
      prisma as unknown as never,
      audit as unknown as AuditService,
    );
  });

  describe('create', () => {
    it('creates a campaign and audits it', async () => {
      prisma.campaign.create.mockResolvedValue(makeCampaign());

      const result = await service.create(
        WORKSPACE_ID,
        USER_ID,
        { name: 'Test Campaign' },
        CTX,
      );

      expect(result.name).toBe('Test Campaign');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'campaign.created' }),
      );
    });

    it('rejects endDate earlier than startDate', async () => {
      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          {
            name: 'Bad',
            startDate: '2026-08-01T00:00:00.000Z',
            endDate: '2026-07-01T00:00:00.000Z',
          },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.campaign.create).not.toHaveBeenCalled();
    });

    it('accepts endDate equal to startDate', async () => {
      prisma.campaign.create.mockResolvedValue(makeCampaign());
      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          {
            name: 'Same Day',
            startDate: '2026-08-01T00:00:00.000Z',
            endDate: '2026-08-01T00:00:00.000Z',
          },
          CTX,
        ),
      ).resolves.toBeDefined();
    });

    it('rejects an invalid UTM default value', async () => {
      await expect(
        service.create(
          WORKSPACE_ID,
          USER_ID,
          { name: 'Bad UTM', utmSource: '<script>bad</script>' },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.campaign.create).not.toHaveBeenCalled();
    });

    it('surfaces a duplicate name (within the workspace) as 409 Conflict', async () => {
      prisma.campaign.create.mockRejectedValue(isUniqueViolation());

      await expect(
        service.create(WORKSPACE_ID, USER_ID, { name: 'Duplicate' }, CTX),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findByIdOrThrow — workspace isolation', () => {
    it('throws NotFoundException for a campaign in another workspace', async () => {
      prisma.campaign.findUnique.mockResolvedValue(
        makeCampaign({ workspaceId: 'other-ws' }),
      );
      await expect(
        service.findByIdOrThrow(WORKSPACE_ID, 'campaign-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for a soft-deleted campaign', async () => {
      prisma.campaign.findUnique.mockResolvedValue(
        makeCampaign({ deletedAt: new Date() }),
      );
      await expect(
        service.findByIdOrThrow(WORKSPACE_ID, 'campaign-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the campaign when it belongs to the workspace', async () => {
      const campaign = makeCampaign();
      prisma.campaign.findUnique.mockResolvedValue(campaign);
      await expect(
        service.findByIdOrThrow(WORKSPACE_ID, 'campaign-1'),
      ).resolves.toBe(campaign);
    });
  });

  describe('transitionStatus — lifecycle', () => {
    it.each([
      [CampaignStatus.DRAFT, CampaignStatus.ACTIVE, true],
      [CampaignStatus.DRAFT, CampaignStatus.ARCHIVED, true],
      [CampaignStatus.DRAFT, CampaignStatus.PAUSED, false],
      [CampaignStatus.DRAFT, CampaignStatus.COMPLETED, false],
      [CampaignStatus.ACTIVE, CampaignStatus.PAUSED, true],
      [CampaignStatus.ACTIVE, CampaignStatus.ARCHIVED, true],
      [CampaignStatus.ACTIVE, CampaignStatus.DRAFT, false],
      [CampaignStatus.PAUSED, CampaignStatus.ACTIVE, true],
      [CampaignStatus.PAUSED, CampaignStatus.ARCHIVED, true],
      [CampaignStatus.ARCHIVED, CampaignStatus.ACTIVE, false],
      [CampaignStatus.ARCHIVED, CampaignStatus.DRAFT, false],
    ])('%s -> %s is %s', async (from, to, shouldSucceed) => {
      prisma.campaign.findUnique.mockResolvedValue(
        makeCampaign({ status: from }),
      );
      prisma.campaign.update.mockResolvedValue(makeCampaign({ status: to }));

      const promise = service.transitionStatus(
        WORKSPACE_ID,
        'campaign-1',
        USER_ID,
        to,
        CTX,
      );

      if (shouldSucceed) {
        await expect(promise).resolves.toBeDefined();
      } else {
        await expect(promise).rejects.toThrow(BadRequestException);
      }
    });

    it('records the correct audit action for each transition', async () => {
      prisma.campaign.findUnique.mockResolvedValue(
        makeCampaign({ status: CampaignStatus.DRAFT }),
      );
      prisma.campaign.update.mockResolvedValue(
        makeCampaign({ status: CampaignStatus.ACTIVE }),
      );

      await service.transitionStatus(
        WORKSPACE_ID,
        'campaign-1',
        USER_ID,
        CampaignStatus.ACTIVE,
        CTX,
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'campaign.activated' }),
      );
    });
  });

  describe('getEffectiveStatus', () => {
    it('reports COMPLETED for an ACTIVE campaign whose endDate has passed', () => {
      const result = service.getEffectiveStatus({
        status: CampaignStatus.ACTIVE,
        endDate: new Date(Date.now() - 1000),
      });
      expect(result).toBe(CampaignStatus.COMPLETED);
    });

    it('reports COMPLETED for a PAUSED campaign whose endDate has passed', () => {
      const result = service.getEffectiveStatus({
        status: CampaignStatus.PAUSED,
        endDate: new Date(Date.now() - 1000),
      });
      expect(result).toBe(CampaignStatus.COMPLETED);
    });

    it('does not affect a DRAFT campaign with a past end date', () => {
      const result = service.getEffectiveStatus({
        status: CampaignStatus.DRAFT,
        endDate: new Date(Date.now() - 1000),
      });
      expect(result).toBe(CampaignStatus.DRAFT);
    });

    it('does not affect an ARCHIVED campaign', () => {
      const result = service.getEffectiveStatus({
        status: CampaignStatus.ARCHIVED,
        endDate: new Date(Date.now() - 1000),
      });
      expect(result).toBe(CampaignStatus.ARCHIVED);
    });

    it('reports the stored status for an ACTIVE campaign with a future or no end date', () => {
      expect(
        service.getEffectiveStatus({
          status: CampaignStatus.ACTIVE,
          endDate: null,
        }),
      ).toBe(CampaignStatus.ACTIVE);
      expect(
        service.getEffectiveStatus({
          status: CampaignStatus.ACTIVE,
          endDate: new Date(Date.now() + 100000),
        }),
      ).toBe(CampaignStatus.ACTIVE);
    });
  });

  describe('softDelete', () => {
    it('sets deletedAt and audits — never touches links', async () => {
      prisma.campaign.findUnique.mockResolvedValue(makeCampaign());
      prisma.campaign.update.mockResolvedValue(
        makeCampaign({ deletedAt: new Date() }),
      );

      await service.softDelete(WORKSPACE_ID, 'campaign-1', USER_ID, CTX);

      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: 'campaign-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.link.update).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'campaign.deleted' }),
      );
    });
  });

  describe('update', () => {
    it('detects a UTM-only update and uses the utm_updated audit action', async () => {
      prisma.campaign.findUnique.mockResolvedValue(makeCampaign());
      prisma.campaign.update.mockResolvedValue(
        makeCampaign({ utmSource: 'facebook' }),
      );

      await service.update(
        WORKSPACE_ID,
        'campaign-1',
        USER_ID,
        { utmSource: 'facebook' },
        CTX,
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'campaign.utm_updated' }),
      );
    });

    it('uses the plain updated audit action for a non-UTM change', async () => {
      prisma.campaign.findUnique.mockResolvedValue(makeCampaign());
      prisma.campaign.update.mockResolvedValue(
        makeCampaign({ name: 'Renamed' }),
      );

      await service.update(
        WORKSPACE_ID,
        'campaign-1',
        USER_ID,
        { name: 'Renamed' },
        CTX,
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'campaign.updated' }),
      );
    });

    it('validates the effective date range using the EXISTING dates when only one is provided', async () => {
      prisma.campaign.findUnique.mockResolvedValue(
        makeCampaign({ startDate: new Date('2026-08-01T00:00:00.000Z') }),
      );

      await expect(
        service.update(
          WORKSPACE_ID,
          'campaign-1',
          USER_ID,
          { endDate: '2026-07-01T00:00:00.000Z' },
          CTX,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
