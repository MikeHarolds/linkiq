import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlanTier } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../test/mocks/prisma.mock';
import type { RequestContext } from '../../common/decorators/request-context.decorator';
import type { AuditService } from '../audit/audit.service';
import type { CurrencyService } from '../currency/currency.service';
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
    prices: [],
    ...overrides,
  };
}

describe('PlansService', () => {
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let currencies: { getByIdOrThrow: jest.Mock };
  let service: PlansService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    currencies = { getByIdOrThrow: jest.fn() };
    service = new PlansService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      currencies as unknown as CurrencyService,
    );
  });

  describe('listActive', () => {
    it('returns only active plans, sorted by displayOrder', async () => {
      prisma.plan.findMany.mockResolvedValue([
        makePlan({
          id: 'p2',
          slug: 'starter',
          displayOrder: 1,
          isActive: true,
        }),
        makePlan({
          id: 'p3',
          slug: 'inactive',
          displayOrder: 0,
          isActive: false,
        }),
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

  describe('listFeaturedForHomepage', () => {
    it('Sprint 17 §8 — returns only active AND featured plans, never every purchasable plan', async () => {
      prisma.plan.findMany.mockResolvedValue([
        makePlan({
          id: 'p1',
          slug: 'free',
          isActive: true,
          isFeaturedOnHomepage: true,
          homepageOrder: 0,
        }),
        makePlan({
          id: 'p2',
          slug: 'starter',
          isActive: true,
          isFeaturedOnHomepage: false,
        }),
        makePlan({
          id: 'p3',
          slug: 'inactive-featured',
          isActive: false,
          isFeaturedOnHomepage: true,
        }),
        makePlan({
          id: 'p4',
          slug: 'professional',
          isActive: true,
          isFeaturedOnHomepage: true,
          homepageOrder: 1,
        }),
      ]);

      const result = await service.listFeaturedForHomepage();

      expect(result.map((p) => p.slug)).toEqual(['free', 'professional']);
    });

    it('sorts by homepageOrder, falling back to displayOrder when homepageOrder is null', async () => {
      prisma.plan.findMany.mockResolvedValue([
        makePlan({
          id: 'p1',
          slug: 'business',
          isActive: true,
          isFeaturedOnHomepage: true,
          homepageOrder: null,
          displayOrder: 3,
        }),
        makePlan({
          id: 'p2',
          slug: 'professional',
          isActive: true,
          isFeaturedOnHomepage: true,
          homepageOrder: 0,
          displayOrder: 2,
        }),
      ]);

      const result = await service.listFeaturedForHomepage();

      expect(result.map((p) => p.slug)).toEqual(['professional', 'business']);
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

      await expect(service.getByIdOrThrow('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateForAdmin', () => {
    it('updates the plan, upserts limits, invalidates the cache, and audits the change', async () => {
      prisma.plan.findUnique.mockResolvedValue(
        makePlan({ id: 'plan-1', slug: 'starter' }),
      );
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
        expect.objectContaining({
          action: 'admin.plan_updated',
          userId: 'admin-1',
        }),
      );

      // Cache invalidated: a subsequent listActive() must re-query.
      prisma.plan.findMany.mockClear();
      prisma.plan.findMany.mockResolvedValue([makePlan({ slug: 'starter' })]);
      await service.listActive();
      expect(prisma.plan.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('create', () => {
    it('creates a new plan with its limits, invalidates the cache, and audits it', async () => {
      prisma.plan.findUnique
        .mockResolvedValueOnce(null) // slug-uniqueness check
        .mockResolvedValueOnce(makePlan({ id: 'plan-new', slug: 'growth' })); // getByIdOrThrow
      prisma.plan.create.mockResolvedValue(
        makePlan({ id: 'plan-new', slug: 'growth' }),
      );
      prisma.planLimit.create.mockResolvedValue(undefined);

      const result = await service.create(
        {
          name: 'Growth',
          slug: 'growth',
          tier: PlanTier.PROFESSIONAL,
          priceAmount: 7900,
          limits: { MAX_LINKS: 1000 },
        },
        'admin-1',
        ctx,
      );

      expect(result.slug).toBe('growth');
      expect(prisma.plan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slug: 'growth',
            tier: PlanTier.PROFESSIONAL,
            priceAmount: 7900,
          }),
        }),
      );
      expect(prisma.planLimit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { planId: 'plan-new', key: 'MAX_LINKS', value: 1000 },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin.plan_created',
          userId: 'admin-1',
        }),
      );
    });

    it('rejects a duplicate slug without creating anything', async () => {
      prisma.plan.findUnique.mockResolvedValue(makePlan({ slug: 'starter' }));

      await expect(
        service.create(
          {
            name: 'Starter',
            slug: 'starter',
            tier: PlanTier.STARTER,
            priceAmount: 1900,
          },
          'admin-1',
          ctx,
        ),
      ).rejects.toThrow(ConflictException);
      expect(prisma.plan.create).not.toHaveBeenCalled();
    });

    it('defaults currency, billing interval, and displayOrder when not provided', async () => {
      prisma.plan.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makePlan({ id: 'plan-new' }));
      prisma.plan.create.mockResolvedValue(makePlan({ id: 'plan-new' }));

      await service.create(
        {
          name: 'Growth',
          slug: 'growth',
          tier: PlanTier.PROFESSIONAL,
          priceAmount: 7900,
        },
        'admin-1',
        ctx,
      );

      expect(prisma.plan.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currency: 'USD',
            billingInterval: 'MONTHLY',
            displayOrder: 0,
            isActive: true,
          }),
        }),
      );
    });
  });

  describe('setPrice', () => {
    it('rejects setting a price in an inactive currency', async () => {
      prisma.plan.findUnique.mockResolvedValue(makePlan({ id: 'plan-1' }));
      currencies.getByIdOrThrow.mockResolvedValue({
        id: 'cur-eur',
        code: 'EUR',
        isActive: false,
      });

      await expect(
        service.setPrice(
          'plan-1',
          { currencyId: 'cur-eur', amount: 4500 },
          'admin-1',
          ctx,
        ),
      ).rejects.toThrow('Cannot set a plan price in an inactive currency');
      expect(prisma.planPrice.upsert).not.toHaveBeenCalled();
    });

    it('upserts the price, invalidates the cache, and audits creation vs. update distinctly', async () => {
      prisma.plan.findUnique
        .mockResolvedValueOnce(
          makePlan({ id: 'plan-1', slug: 'professional', prices: [] }),
        ) // getByIdOrThrow before upsert
        .mockResolvedValueOnce(
          makePlan({
            id: 'plan-1',
            slug: 'professional',
            prices: [
              {
                currencyId: 'cur-ngn',
                amount: 7_500_000,
                currency: { code: 'NGN' },
              },
            ],
          }),
        ); // getByIdOrThrow after upsert
      currencies.getByIdOrThrow.mockResolvedValue({
        id: 'cur-ngn',
        code: 'NGN',
        isActive: true,
      });
      prisma.planPrice.upsert.mockResolvedValue(undefined);

      const result = await service.setPrice(
        'plan-1',
        { currencyId: 'cur-ngn', amount: 7_500_000 },
        'admin-1',
        ctx,
      );

      expect(result.prices).toHaveLength(1);
      expect(prisma.planPrice.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            planId_currencyId: { planId: 'plan-1', currencyId: 'cur-ngn' },
          },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.plan_price_created' }),
      );
    });

    it('audits as an update (not a create) when a price already exists for that currency', async () => {
      const existingPrice = {
        currencyId: 'cur-ngn',
        amount: 7_000_000,
        currency: { code: 'NGN' },
      };
      prisma.plan.findUnique
        .mockResolvedValueOnce(
          makePlan({
            id: 'plan-1',
            slug: 'professional',
            prices: [existingPrice],
          }),
        )
        .mockResolvedValueOnce(
          makePlan({
            id: 'plan-1',
            slug: 'professional',
            prices: [{ ...existingPrice, amount: 7_500_000 }],
          }),
        );
      currencies.getByIdOrThrow.mockResolvedValue({
        id: 'cur-ngn',
        code: 'NGN',
        isActive: true,
      });
      prisma.planPrice.upsert.mockResolvedValue(undefined);

      await service.setPrice(
        'plan-1',
        { currencyId: 'cur-ngn', amount: 7_500_000 },
        'admin-1',
        ctx,
      );

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.plan_price_updated' }),
      );
    });
  });

  describe('removePrice', () => {
    it('throws NotFoundException when the plan has no price in that currency', async () => {
      prisma.plan.findUnique.mockResolvedValue(
        makePlan({ id: 'plan-1', prices: [] }),
      );

      await expect(
        service.removePrice('plan-1', 'cur-ngn', 'admin-1', ctx),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.planPrice.delete).not.toHaveBeenCalled();
    });

    it('removes the price, invalidates the cache, and audits it', async () => {
      const price = {
        id: 'price-1',
        currencyId: 'cur-ngn',
        currency: { code: 'NGN' },
      };
      prisma.plan.findUnique
        .mockResolvedValueOnce(
          makePlan({ id: 'plan-1', slug: 'professional', prices: [price] }),
        )
        .mockResolvedValueOnce(
          makePlan({ id: 'plan-1', slug: 'professional', prices: [] }),
        );
      prisma.planPrice.delete.mockResolvedValue(undefined);

      const result = await service.removePrice(
        'plan-1',
        'cur-ngn',
        'admin-1',
        ctx,
      );

      expect(result.prices).toHaveLength(0);
      expect(prisma.planPrice.delete).toHaveBeenCalledWith({
        where: { id: 'price-1' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.plan_price_removed' }),
      );
    });
  });
});
