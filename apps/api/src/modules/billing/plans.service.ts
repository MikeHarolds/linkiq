import { Injectable, NotFoundException } from '@nestjs/common';
import { PlanTier, type Plan, type PlanLimit } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export type PlanWithLimits = Plan & { limits: PlanLimit[] };

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Plans are seed-managed data with no edit endpoint this sprint — a
 * short-lived in-memory cache (not Redis) avoids a database round trip on
 * every limit check without the operational weight of a distributed
 * cache for something that never changes at runtime. See
 * BillingUsageService, the main caller.
 */
@Injectable()
export class PlansService {
  private cache: { plans: PlanWithLimits[]; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async listActive(): Promise<PlanWithLimits[]> {
    const all = await this.getAllCached();
    return all
      .filter((plan) => plan.isActive)
      .sort((a, b) => a.displayOrder - b.displayOrder);
  }

  async getBySlug(slug: string): Promise<PlanWithLimits> {
    const all = await this.getAllCached();
    const plan = all.find((p) => p.slug === slug);
    if (!plan) {
      throw new NotFoundException('Plan not found');
    }
    return plan;
  }

  /** The fallback plan for a workspace whose subscription isn't
   * effectively active (expired trial, past cancellation date, no
   * subscription at all) — see BillingUsageService. Throws only if the
   * database has no FREE-tier plan configured at all, which is a seed
   * misconfiguration, not a per-workspace condition. */
  async getFreePlan(): Promise<PlanWithLimits> {
    const all = await this.getAllCached();
    const plan = all
      .filter((p) => p.tier === PlanTier.FREE)
      .sort((a, b) => a.displayOrder - b.displayOrder)[0];
    if (!plan) {
      throw new NotFoundException(
        'No FREE plan is configured — run the seed script',
      );
    }
    return plan;
  }

  private async getAllCached(): Promise<PlanWithLimits[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.plans;
    }
    const plans = await this.prisma.plan.findMany({
      include: { limits: true },
      orderBy: { displayOrder: 'asc' },
    });
    this.cache = { plans, expiresAt: now + CACHE_TTL_MS };
    return plans;
  }
}
