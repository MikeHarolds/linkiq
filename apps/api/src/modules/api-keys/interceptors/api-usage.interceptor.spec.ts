import {
  ForbiddenException,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { PlanLimitKey } from '@prisma/client';
import { lastValueFrom, of, throwError } from 'rxjs';

import type { BillingUsageService } from '../../billing/billing-usage.service';
import { ApiPlanLimitExceededException } from '../exceptions/api-plan-limit-exceeded.exception';
import type { ApiUsageProducer } from '../queue/api-usage.producer';
import type { ApiKeyAuthContext } from '../types/api-key-auth-context.type';

import { ApiUsageInterceptor } from './api-usage.interceptor';

const apiKeyAuth: ApiKeyAuthContext = {
  authenticationType: 'api_key',
  apiKeyId: 'key-1',
  workspaceId: 'ws-1',
  createdById: 'user-1',
  permissions: ['LINKS_READ'],
};

function makeContext(overrides: {
  apiKeyAuth?: ApiKeyAuthContext;
  statusCode?: number;
}): ExecutionContext {
  const request = {
    apiKeyAuth: overrides.apiKeyAuth,
    method: 'POST',
    path: '/api/v1/links',
    route: { path: '/api/v1/links' },
  };
  const response = { statusCode: overrides.statusCode ?? 200 };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('ApiUsageInterceptor', () => {
  let billingUsage: jest.Mocked<Pick<BillingUsageService, 'getUsageAndLimit'>>;
  let producer: jest.Mocked<Pick<ApiUsageProducer, 'enqueue'>>;
  let interceptor: ApiUsageInterceptor;

  beforeEach(() => {
    billingUsage = { getUsageAndLimit: jest.fn() };
    producer = { enqueue: jest.fn() };
    interceptor = new ApiUsageInterceptor(
      billingUsage as unknown as BillingUsageService,
      producer as unknown as ApiUsageProducer,
    );
  });

  it('is a no-op for a request with no apiKeyAuth (browser/JWT traffic)', async () => {
    const handler: CallHandler = { handle: () => of('handled') };
    const context = makeContext({});

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(billingUsage.getUsageAndLimit).not.toHaveBeenCalled();
    expect(producer.enqueue).not.toHaveBeenCalled();
  });

  it('calls the handler and records usage when within the plan limit', async () => {
    billingUsage.getUsageAndLimit.mockResolvedValue({ limit: 1000, usage: 5 });
    const handler: CallHandler = { handle: () => of('handled') };
    const context = makeContext({ apiKeyAuth, statusCode: 201 });

    const result$ = await interceptor.intercept(context, handler);
    const result = await lastValueFrom(result$);

    expect(result).toBe('handled');
    expect(producer.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        apiKeyId: 'key-1',
        endpoint: '/api/v1/links',
        method: 'POST',
        statusCode: 201,
      }),
    );
  });

  it('never calls the handler when the monthly plan limit is exhausted', async () => {
    billingUsage.getUsageAndLimit.mockResolvedValue({
      limit: 1000,
      usage: 1000,
    });
    const handle = jest.fn(() => of('should not run'));
    const context = makeContext({ apiKeyAuth });

    await expect(interceptor.intercept(context, { handle })).rejects.toThrow(
      ApiPlanLimitExceededException,
    );
    expect(handle).not.toHaveBeenCalled();
    expect(producer.enqueue).not.toHaveBeenCalled();
  });

  it('never blocks when the plan limit is unlimited (null)', async () => {
    billingUsage.getUsageAndLimit.mockResolvedValue({
      limit: null,
      usage: 999_999,
    });
    const handler: CallHandler = { handle: () => of('handled') };
    const context = makeContext({ apiKeyAuth });

    const result$ = await interceptor.intercept(context, handler);
    await expect(lastValueFrom(result$)).resolves.toBe('handled');
  });

  it('still records a usage event when the handler throws, using the real error status', async () => {
    billingUsage.getUsageAndLimit.mockResolvedValue({ limit: 1000, usage: 5 });
    const error = new ForbiddenException('nope');
    const handler: CallHandler = { handle: () => throwError(() => error) };
    const context = makeContext({ apiKeyAuth });

    const result$ = await interceptor.intercept(context, handler);
    await expect(lastValueFrom(result$)).rejects.toBe(error);

    expect(producer.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it("checks MONTHLY_API_REQUESTS specifically, scoped to the key's workspace", async () => {
    billingUsage.getUsageAndLimit.mockResolvedValue({ limit: 1000, usage: 5 });
    const handler: CallHandler = { handle: () => of('handled') };
    const context = makeContext({ apiKeyAuth });

    const result$ = await interceptor.intercept(context, handler);
    await lastValueFrom(result$);

    expect(billingUsage.getUsageAndLimit).toHaveBeenCalledWith(
      'ws-1',
      PlanLimitKey.MONTHLY_API_REQUESTS,
    );
  });
});
