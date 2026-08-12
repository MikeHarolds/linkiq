import { ForbiddenException } from '@nestjs/common';

/**
 * The structured billing/limit error from docs/architecture/billing.md —
 * lets the frontend distinguish "plan limit reached" from a generic 403,
 * without exposing anything about how billing is implemented internally.
 * Thrown by every limit-enforcement call site (Links/QrCodes/Campaigns/
 * Domains/Workspaces `create`), never by the redirect path.
 */
export class PlanLimitExceededException extends ForbiddenException {
  constructor(feature: string, limit: number, usage: number) {
    const remaining = Math.max(0, limit - usage);
    super({
      code: 'PLAN_LIMIT_REACHED',
      feature,
      limit,
      usage,
      remaining,
      message: `You've reached your plan's ${feature} limit (${usage}/${limit}). Upgrade your plan to continue.`,
    });
  }
}
