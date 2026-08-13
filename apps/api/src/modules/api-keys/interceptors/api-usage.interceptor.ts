import {
  HttpException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { PlanLimitKey } from '@prisma/client';
import type { Request, Response } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';

import { BillingUsageService } from '../../billing/billing-usage.service';
import { ApiPlanLimitExceededException } from '../exceptions/api-plan-limit-exceeded.exception';
import { ApiUsageProducer } from '../queue/api-usage.producer';
import type { ApiKeyAuthContext } from '../types/api-key-auth-context.type';

type ApiRequest = Request & { apiKeyAuth?: ApiKeyAuthContext };

/**
 * Global (see app.module.ts APP_INTERCEPTOR) but a complete no-op for any
 * request without `request.apiKeyAuth` — every browser/JWT request and
 * the public redirect path never enter the branch below at all, so this
 * never touches their latency or behavior.
 *
 * For an API-key-authenticated request, does exactly two things:
 *   1. Before calling the handler — checks MONTHLY_API_REQUESTS via
 *      BillingUsageService.getUsageAndLimit (the same aggregate-count
 *      pattern already used for MONTHLY_CLICKS), throwing
 *      ApiPlanLimitExceededException if exhausted. This is the only
 *      place that limit is ever enforced — links/redirects/QR/campaigns/
 *      domains never see it.
 *   2. After the handler settles (success or error) — enqueues a usage
 *      event via ApiUsageProducer, fire-and-forget, never awaited into
 *      the response.
 */
@Injectable()
export class ApiUsageInterceptor implements NestInterceptor {
  constructor(
    private readonly billingUsage: BillingUsageService,
    private readonly producer: ApiUsageProducer,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const apiKeyAuth = request.apiKeyAuth;

    if (!apiKeyAuth) {
      return next.handle();
    }

    const { limit, usage } = await this.billingUsage.getUsageAndLimit(
      apiKeyAuth.workspaceId,
      PlanLimitKey.MONTHLY_API_REQUESTS,
    );
    if (limit !== null && usage + 1 > limit) {
      throw new ApiPlanLimitExceededException(limit, usage);
    }

    const startedAt = Date.now();
    const endpoint = request.route?.path ?? request.path;
    const method = request.method;
    const response = context.switchToHttp().getResponse<Response>();

    const record = (statusCode: number): void => {
      this.producer.enqueue({
        workspaceId: apiKeyAuth.workspaceId,
        apiKeyId: apiKeyAuth.apiKeyId,
        endpoint,
        method,
        statusCode,
        durationMs: Date.now() - startedAt,
      });
    };

    return next.handle().pipe(
      tap(() => record(response.statusCode || 200)),
      catchError((error: unknown) => {
        record(error instanceof HttpException ? error.getStatus() : 500);
        return throwError(() => error);
      }),
    );
  }
}
