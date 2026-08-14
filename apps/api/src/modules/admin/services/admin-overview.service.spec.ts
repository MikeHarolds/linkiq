import { BillingInterval } from '@prisma/client';

import {
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../test/mocks/prisma.mock';

import { AdminOverviewService } from './admin-overview.service';

describe('AdminOverviewService', () => {
  let prisma: MockPrismaService;
  let service: AdminOverviewService;
  const from = new Date('2026-08-01');
  const to = new Date('2026-08-13');

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new AdminOverviewService(prisma as unknown as never);

    prisma.user.count.mockResolvedValue(0);
    prisma.workspace.count.mockResolvedValue(0);
    prisma.link.count.mockResolvedValue(0);
    prisma.clickEvent.count.mockResolvedValue(0);
    prisma.subscription.count.mockResolvedValue(0);
    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.invoice.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prisma.invoice.count.mockResolvedValue(0);
    prisma.apiUsageEvent.count.mockResolvedValue(0);
    prisma.webhookDelivery.count.mockResolvedValue(0);
    prisma.customDomain.count.mockResolvedValue(0);
  });

  it('sums MONTHLY active-plan prices as-is toward MRR', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      {
        plan: {
          priceAmount: 1900,
          currency: 'USD',
          billingInterval: BillingInterval.MONTHLY,
        },
      },
      {
        plan: {
          priceAmount: 4900,
          currency: 'USD',
          billingInterval: BillingInterval.MONTHLY,
        },
      },
    ]);

    const result = await service.getOverview(from, to);

    expect(result.mrr.amount).toBe(6800);
    expect(result.mrr.currency).toBe('USD');
    expect(result.mrr.note).toBeNull();
  });

  it('divides ANNUAL active-plan prices by 12 for the monthly-equivalent MRR', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      {
        plan: {
          priceAmount: 12000,
          currency: 'USD',
          billingInterval: BillingInterval.ANNUAL,
        },
      },
    ]);

    const result = await service.getOverview(from, to);

    expect(result.mrr.amount).toBe(1000);
  });

  it('flags mixed-currency active plans via `note` instead of silently summing them', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      {
        plan: {
          priceAmount: 1900,
          currency: 'USD',
          billingInterval: BillingInterval.MONTHLY,
        },
      },
      {
        plan: {
          priceAmount: 5000,
          currency: 'NGN',
          billingInterval: BillingInterval.MONTHLY,
        },
      },
    ]);

    const result = await service.getOverview(from, to);

    expect(result.mrr.currency).toBeNull();
    expect(result.mrr.note).toContain('2 currencies');
    // The amount is still computed (not silently dropped) even though
    // it isn't meaningfully "a currency total" across mixed currencies.
    expect(result.mrr.amount).toBe(6900);
  });

  it('treats a null invoice aggregate sum as zero collected revenue', async () => {
    prisma.invoice.aggregate.mockResolvedValue({ _sum: { amount: null } });
    const result = await service.getOverview(from, to);
    expect(result.revenue.collectedInRange).toBe(0);
  });

  it('passes the requested date range through to range-scoped queries', async () => {
    await service.getOverview(from, to);

    expect(prisma.clickEvent.count).toHaveBeenCalledWith({
      where: { occurredAt: { gte: from, lte: to } },
    });
    expect(prisma.apiUsageEvent.count).toHaveBeenCalledWith({
      where: { createdAt: { gte: from, lte: to } },
    });
  });
});
