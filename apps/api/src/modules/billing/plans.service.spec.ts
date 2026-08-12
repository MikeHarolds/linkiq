import { NotFoundException } from '@nestjs/common';
import { PlanTier } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { PrismaService } from '../prisma/prisma.service';

import { PlansService } from './plans.service';

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
  let service: PlansService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new PlansService(prisma as unknown as PrismaService);
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
});
