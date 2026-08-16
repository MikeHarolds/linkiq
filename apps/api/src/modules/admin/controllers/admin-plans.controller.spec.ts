import type { PlanTier } from '@prisma/client';

import type { RequestContext } from '../../../common/decorators/request-context.decorator';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import type { PlansService } from '../../billing/plans.service';
import type { BillingProvider } from '../../billing/providers/billing-provider.interface';
import type { CreatePlanDto } from '../dto/create-plan.dto';

import { AdminPlansController } from './admin-plans.controller';

const ctx: RequestContext = { ipAddress: '127.0.0.1', userAgent: 'jest' };
const admin = { id: 'admin-1', globalRole: 'SUPER_ADMIN' } as AuthenticatedUser;

function makePlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'plan-1',
    name: 'Growth',
    slug: 'growth',
    tier: 'PROFESSIONAL' as PlanTier,
    priceAmount: 7900,
    currency: 'USD',
    billingInterval: 'MONTHLY',
    providerPlanId: null,
    limits: [],
    ...overrides,
  };
}

describe('AdminPlansController', () => {
  let plans: { create: jest.Mock; updateForAdmin: jest.Mock; listAllForAdmin: jest.Mock; getByIdOrThrow: jest.Mock };
  let billingProvider: { createProviderPlan?: jest.Mock };
  let controller: AdminPlansController;

  beforeEach(() => {
    plans = {
      create: jest.fn(),
      updateForAdmin: jest.fn(),
      listAllForAdmin: jest.fn(),
      getByIdOrThrow: jest.fn(),
    };
    billingProvider = { createProviderPlan: jest.fn() };
    controller = new AdminPlansController(
      plans as unknown as PlansService,
      billingProvider as unknown as BillingProvider,
    );
  });

  describe('create', () => {
    it('creates the plan locally without ever calling the provider when syncToProvider is not set', async () => {
      plans.create.mockResolvedValue(makePlan());

      const dto = {
        name: 'Growth',
        slug: 'growth',
        tier: 'PROFESSIONAL' as PlanTier,
        priceAmount: 7900,
      } as CreatePlanDto;
      const result = await controller.create(dto, admin, ctx);

      expect(result.slug).toBe('growth');
      expect(billingProvider.createProviderPlan).not.toHaveBeenCalled();
      expect(plans.updateForAdmin).not.toHaveBeenCalled();
    });

    it('syncs to the provider and persists the resulting providerPlanId when syncToProvider is set', async () => {
      plans.create.mockResolvedValue(makePlan());
      (billingProvider.createProviderPlan as jest.Mock).mockResolvedValue({ providerPlanId: 'PLN_abc123' });
      plans.updateForAdmin.mockResolvedValue(makePlan({ providerPlanId: 'PLN_abc123' }));

      const dto = {
        name: 'Growth',
        slug: 'growth',
        tier: 'PROFESSIONAL' as PlanTier,
        priceAmount: 7900,
        syncToProvider: true,
      } as CreatePlanDto;
      const result = await controller.create(dto, admin, ctx);

      expect(billingProvider.createProviderPlan).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Growth', priceAmount: 7900, currency: 'USD' }),
      );
      expect(plans.updateForAdmin).toHaveBeenCalledWith(
        'plan-1',
        { providerPlanId: 'PLN_abc123' },
        'admin-1',
        ctx,
      );
      expect(result.providerPlanId).toBe('PLN_abc123');
    });

    it('still returns the locally-created plan when provider sync fails (best-effort, never blocks creation)', async () => {
      plans.create.mockResolvedValue(makePlan());
      (billingProvider.createProviderPlan as jest.Mock).mockRejectedValue(new Error('Paystack unreachable'));

      const dto = {
        name: 'Growth',
        slug: 'growth',
        tier: 'PROFESSIONAL' as PlanTier,
        priceAmount: 7900,
        syncToProvider: true,
      } as CreatePlanDto;
      const result = await controller.create(dto, admin, ctx);

      expect(result.slug).toBe('growth');
      expect(result.providerPlanId).toBeNull();
      expect(plans.updateForAdmin).not.toHaveBeenCalled();
    });

    it('skips sync silently when the active provider does not implement createProviderPlan', async () => {
      plans.create.mockResolvedValue(makePlan());
      billingProvider.createProviderPlan = undefined;

      const dto = {
        name: 'Growth',
        slug: 'growth',
        tier: 'PROFESSIONAL' as PlanTier,
        priceAmount: 7900,
        syncToProvider: true,
      } as CreatePlanDto;
      const result = await controller.create(dto, admin, ctx);

      expect(result.slug).toBe('growth');
      expect(plans.updateForAdmin).not.toHaveBeenCalled();
    });
  });
});
