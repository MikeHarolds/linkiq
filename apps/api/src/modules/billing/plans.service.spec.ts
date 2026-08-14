import { NotFoundException } from '@nestjs/common';
import { PlanTier } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';

import { PlansService } from './plans.service';

const ctx: RequestContext = { ipAddress: '127.0.0.1', userAgent: 'jest' };

function makePlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'plan-1',
    name: 'Free',
    slug: 'free',
    tier: PlanTier.FREE,
    description: null,
    priceAmount: 0,
    currency: 'USD',
    billingInterval: 'MONTHLY',
    trialDays: null,
    isActive: true,
    displayOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    limits: [],
    ...overrides,
  };
}

describe('PlansService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let service: PlansService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new PlansService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  describe('listActive', () => {
    it('returns only active plans, sorted by displayOrder', async () => {
      prisma.plan.findMany.mockResolvedValue([
        makePlan({ id: 'p2', slug: 'starter', displayOrder: 1, isActive: true }),
        makePlan({ id: 'p3', slug: 'inactive', displayOrder: 0, isActive: false }),
        makePlan({ id: 'p1', slug: 'free', displayOrder: 0, isActive: true }),
      ]);

      const result = await service.listActive();

      expect(result.map((p) => p.slug)).toEqual(['free', 'starter']);
    });

    it('only queries the database once across repeated calls within the TTL', async () => {
      prisma.plan.findMany.mockResolvedValue([makePlan()]);

      await service.listActive();
      await service.listActive();

      expect(prisma.plan.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('getBySlug', () => {
    it('returns the matching plan', async () => {
      prisma.plan.findMany.mockResolvedValue([makePlan({ slug: 'starter' })]);

      const plan = await service.getBySlug('starter');

      expect(plan.slug).toBe('starter');
    });

    it('throws NotFoundException when no plan matches the slug', async () => {
      prisma.plan.findMany.mockResolvedValue([makePlan({ slug: 'starter' })]);

      await expect(service.getBySlug('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getFreePlan', () => {
    it('returns the FREE-tier plan', async () => {
      prisma.plan.findMany.mockResolvedValue([
        makePlan({ slug: 'starter', tier: PlanTier.STARTER }),
        makePlan({ slug: 'free', tier: PlanTier.FREE }),
      ]);

      const plan = await service.getFreePlan();

      expect(plan.slug).toBe('free');
    });

    it('throws NotFoundException when no FREE plan is configured', async () => {
      prisma.plan.findMany.mockResolvedValue([
        makePlan({ slug: 'starter', tier: PlanTier.STARTER }),
      ]);

      await expect(service.getFreePlan()).rejects.toThrow(NotFoundException);
    });
  });

  describe('listAllForAdmin', () => {
    it('includes inactive plans, sorted by displayOrder', async () => {
      prisma.plan.findMany.mockResolvedValue([
        makePlan({ slug: 'starter', displayOrder: 1, isActive: true }),
        makePlan({ slug: 'inactive', displayOrder: 0, isActive: false }),
      ]);

      const result = await service.listAllForAdmin();

      expect(result.map((p) => p.slug)).toEqual(['inactive', 'starter']);
    });
  });

  describe('getByIdOrThrow', () => {
    it('returns the plan by id', async () => {
      prisma.plan.findUnique.mockResolvedValue(makePlan({ id: 'plan-1' }));

      const plan = await service.getByIdOrThrow('plan-1');

      expect(plan.id).toBe('plan-1');
    });

    it('throws NotFoundException for an unknown id', async () => {
      prisma.plan.findUnique.mockResolvedValue(null);

      await expect(service.getByIdOrThrow('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateForAdmin', () => {
    it('updates the plan, upserts limits, invalidates the cache, and audits the change', async () => {
      prisma.plan.findUnique.mockResolvedValue(makePlan({ id: 'plan-1', slug: 'starter' }));
      prisma.plan.update.mockResolvedValue(undefined);
      prisma.planLimit.upsert.mockResolvedValue(undefined);
      // Warm the cache first, to prove the update invalidates it.
      prisma.plan.findMany.mockResolvedValue([makePlan({ slug: 'starter' })]);
      await service.listActive();

      await service.updateForAdmin(
        'plan-1',
        { isActive: false, limits: { MAX_LINKS: 5 } },
        'admin-1',
        ctx,
      );

      expect(prisma.plan.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'plan-1' },
          data: expect.objectContaining({ isActive: false }),
        }),
      );
      expect(prisma.planLimit.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { planId_key: { planId: 'plan-1', key: 'MAX_LINKS' } },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.plan_updated', userId: 'admin-1' }),
      );

      // Cache invalidated: a subsequent listActive() must re-query.
      prisma.plan.findMany.mockClear();
      prisma.plan.findMany.mockResolvedValue([makePlan({ slug: 'starter' })]);
      await service.listActive();
      expect(prisma.plan.findMany).toHaveBeenCalledTimes(1);
    });
  });
});
