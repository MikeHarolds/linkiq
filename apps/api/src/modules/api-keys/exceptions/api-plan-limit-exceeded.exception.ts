import { ForbiddenException } from '@nestjs/common';

/** Sibling of billing/exceptions/plan-limit-exceeded.exception.ts, same
 * response shape, for the one API-specific limit (MONTHLY_API_REQUESTS).
 * Never thrown for anything other than API-key-authenticated requests —
 * links/redirects/QR/campaigns/domains never see this. */
export class ApiPlanLimitExceededException extends ForbiddenException {
  constructor(limit: number, usage: number) {
    const remaining = Math.max(0, limit - usage);
    super({
      code: 'API_PLAN_LIMIT_REACHED',
      feature: 'API requests',
      limit,
      usage,
      remaining,
      message: `You've reached your plan's monthly API request limit (${usage}/${limit}). Upgrade your plan to continue.`,
    });
  }
}
