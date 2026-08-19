import type { ConfigService } from '@nestjs/config';

import { PaystackApiClient } from './paystack-api.client';
import { PaystackApiException } from './paystack-api.exception';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('PaystackApiClient', () => {
  let config: { get: jest.Mock };
  let client: PaystackApiClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    config = {
      get: jest.fn((key: string) => {
        if (key === 'paystack.secretKey') return 'sk_test_secret';
        if (key === 'paystack.apiBaseUrl') return 'https://api.paystack.co';
        return undefined;
      }),
    };
    client = new PaystackApiClient(config as unknown as ConfigService);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('sends the secret key as a Bearer token and never in the body', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'ok',
        data: { customer_code: 'CUS_1', email: 'a@b.com' },
      }),
    );

    await client.createCustomer('a@b.com');

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.paystack.co/customer');
    expect(options.headers.Authorization).toBe('Bearer sk_test_secret');
    expect(JSON.parse(options.body)).not.toHaveProperty('secretKey');
    expect(options.body).not.toContain('sk_test_secret');
  });

  it('createCustomer maps the response to camelCase', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Customer created',
        data: { customer_code: 'CUS_abc', email: 'a@b.com' },
      }),
    );

    const result = await client.createCustomer('a@b.com', {
      workspaceId: 'ws-1',
    });

    expect(result).toEqual({ customerCode: 'CUS_abc', email: 'a@b.com' });
  });

  it('initializeTransaction sends amount/reference/plan and maps the response', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Authorization URL created',
        data: {
          authorization_url: 'https://checkout.paystack.com/xyz',
          access_code: 'access_xyz',
          reference: 'txn-abc',
        },
      }),
    );

    const result = await client.initializeTransaction({
      email: 'a@b.com',
      amountKobo: 190000,
      currency: 'NGN',
      reference: 'txn-abc',
      planCode: 'PLN_starter',
    });

    const [, options] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse(options.body);
    expect(sentBody).toMatchObject({
      email: 'a@b.com',
      amount: 190000,
      currency: 'NGN',
      reference: 'txn-abc',
      plan: 'PLN_starter',
    });
    expect(result).toEqual({
      authorizationUrl: 'https://checkout.paystack.com/xyz',
      accessCode: 'access_xyz',
      reference: 'txn-abc',
    });
  });

  it('verifyTransaction maps a successful transaction, including nested fields', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Verification successful',
        data: {
          status: 'success',
          reference: 'txn-abc',
          amount: 190000,
          currency: 'USD',
          customer: { customer_code: 'CUS_abc' },
          authorization: { authorization_code: 'AUTH_abc' },
          plan: 'PLN_starter',
          paid_at: '2026-08-13T10:00:00.000Z',
        },
      }),
    );

    const result = await client.verifyTransaction('txn-abc');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/verify/txn-abc',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual({
      status: 'success',
      reference: 'txn-abc',
      amountKobo: 190000,
      currency: 'USD',
      customerCode: 'CUS_abc',
      authorizationCode: 'AUTH_abc',
      planCode: 'PLN_starter',
      paidAt: new Date('2026-08-13T10:00:00.000Z'),
      metadata: null,
    });
  });

  it('verifyTransaction tolerates missing nested customer/authorization fields', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Verification successful',
        data: {
          status: 'abandoned',
          reference: 'txn-abc',
          amount: 190000,
        },
      }),
    );

    const result = await client.verifyTransaction('txn-abc');

    expect(result).toEqual({
      status: 'abandoned',
      reference: 'txn-abc',
      amountKobo: 190000,
      currency: null,
      customerCode: null,
      authorizationCode: null,
      planCode: null,
      paidAt: null,
      metadata: null,
    });
  });

  it('verifyTransaction echoes back metadata sent at initialize time', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Verification successful',
        data: {
          status: 'success',
          reference: 'txn-abc',
          amount: 190000,
          metadata: { workspaceId: 'ws-1', planSlug: 'starter' },
        },
      }),
    );

    const result = await client.verifyTransaction('txn-abc');

    expect(result.metadata).toEqual({
      workspaceId: 'ws-1',
      planSlug: 'starter',
    });
  });

  it('getSubscription maps a known subscription', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'ok',
        data: {
          subscription_code: 'SUB_abc',
          status: 'active',
          next_payment_date: '2026-09-13T10:00:00.000Z',
        },
      }),
    );

    const result = await client.getSubscription('SUB_abc');

    expect(result).toEqual({
      subscriptionCode: 'SUB_abc',
      status: 'active',
      nextPaymentDate: new Date('2026-09-13T10:00:00.000Z'),
    });
  });

  it('getSubscription returns null on a 404 instead of throwing', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ status: false, message: 'Subscription not found' }, 404),
    );

    await expect(client.getSubscription('SUB_missing')).resolves.toBeNull();
  });

  it('getSubscription rethrows non-404 errors', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ status: false, message: 'Server error' }, 500),
    );

    await expect(client.getSubscription('SUB_abc')).rejects.toThrow(
      PaystackApiException,
    );
  });

  it('createPlan maps the response', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Plan created',
        data: { plan_code: 'PLN_starter' },
      }),
    );

    const result = await client.createPlan({
      name: 'Starter Monthly',
      amountKobo: 1900000,
      interval: 'monthly',
    });

    expect(result).toEqual({ planCode: 'PLN_starter' });
  });

  it('createSubscription maps the response', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Subscription created',
        data: {
          subscription_code: 'SUB_abc',
          email_token: 'tok_abc',
          status: 'active',
        },
      }),
    );

    const result = await client.createSubscription({
      customerCode: 'CUS_abc',
      planCode: 'PLN_starter',
    });

    expect(result).toEqual({
      subscriptionCode: 'SUB_abc',
      emailToken: 'tok_abc',
      status: 'active',
    });
  });

  it('disableSubscription posts the code and token', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Subscription disabled',
        data: {},
      }),
    );

    await client.disableSubscription('SUB_abc', 'tok_abc');

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.paystack.co/subscription/disable');
    expect(JSON.parse(options.body)).toEqual({
      code: 'SUB_abc',
      token: 'tok_abc',
    });
  });

  it('createRefund omits amount for a full refund', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ status: true, message: 'Refund queued', data: {} }),
    );

    await client.createRefund({ transactionReference: 'txn-abc' });

    const [, options] = fetchSpy.mock.calls[0];
    const sentBody = JSON.parse(options.body);
    expect(sentBody).toEqual({ transaction: 'txn-abc' });
    expect(sentBody).not.toHaveProperty('amount');
  });

  it('createRefund includes amount for a partial refund', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ status: true, message: 'Refund queued', data: {} }),
    );

    await client.createRefund({
      transactionReference: 'txn-abc',
      amountKobo: 50000,
    });

    const [, options] = fetchSpy.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      transaction: 'txn-abc',
      amount: 50000,
    });
  });

  it('throws PaystackApiException on a non-2xx HTTP response', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ status: false, message: 'Invalid key' }, 401),
    );

    await expect(client.createCustomer('a@b.com')).rejects.toThrow(
      PaystackApiException,
    );
    await expect(client.createCustomer('a@b.com')).rejects.toThrow(
      'Invalid key',
    );
  });

  it('throws PaystackApiException on a 2xx response with status:false in the envelope', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(
        { status: false, message: 'Transaction reference used before' },
        200,
      ),
    );

    await expect(
      client.initializeTransaction({
        email: 'a@b.com',
        amountKobo: 190000,
        currency: 'NGN',
        reference: 'dup-ref',
      }),
    ).rejects.toThrow('Transaction reference used before');
  });

  it('throws PaystackApiException with a null status on a network error', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNRESET'));

    await expect(client.createCustomer('a@b.com')).rejects.toMatchObject({
      status: null,
    });
  });

  it('throws PaystackApiException on a request timeout (AbortError)', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchSpy.mockRejectedValue(abortError);

    await expect(client.createCustomer('a@b.com')).rejects.toThrow(/timed out/);
  });

  it('does not throw when the response body is not valid JSON', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Unexpected token')),
    } as unknown as Response);

    await expect(client.createCustomer('a@b.com')).rejects.toThrow(
      PaystackApiException,
    );
  });
});
