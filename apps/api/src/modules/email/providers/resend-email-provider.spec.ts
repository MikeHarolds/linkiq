import { ResendEmailProvider } from './resend-email-provider';

function makeProvider() {
  return new ResendEmailProvider({
    apiKey: 're_test_key',
    fromEmail: 'noreply@linkiq.example',
    fromName: 'LinkIQ',
    timeoutMs: 5000,
  });
}

describe('ResendEmailProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('send', () => {
    it('POSTs to the Resend API with the correct auth header and payload shape', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: 'msg_123' }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const provider = makeProvider();
      const result = await provider.send({
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
      });

      expect(result).toEqual({ success: true, providerMessageId: 'msg_123' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer re_test_key',
          }),
        }),
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body).toEqual({
        from: 'LinkIQ <noreply@linkiq.example>',
        to: ['user@example.com'],
        subject: 'Hello',
        html: '<p>Hi</p>',
      });
    });

    it('classifies a 429 as retryable', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ message: 'Rate limited' }),
      }) as unknown as typeof fetch;

      const result = await makeProvider().send({
        to: 'a@b.com',
        subject: 's',
        html: 'h',
      });
      expect(result).toEqual({
        success: false,
        errorMessage: 'Rate limited',
        retryable: true,
      });
    });

    it('classifies a 400 as non-retryable', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'Invalid recipient' }),
      }) as unknown as typeof fetch;

      const result = await makeProvider().send({
        to: 'a@b.com',
        subject: 's',
        html: 'h',
      });
      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);
    });

    it('classifies a network error as retryable', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch;

      const result = await makeProvider().send({
        to: 'a@b.com',
        subject: 's',
        html: 'h',
      });
      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
    });
  });

  describe('testConnection', () => {
    it('reports ok on a successful authenticated call', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
      }) as unknown as typeof fetch;
      const result = await makeProvider().testConnection();
      expect(result.ok).toBe(true);
    });

    it('reports not-ok on a 401', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
      }) as unknown as typeof fetch;
      const result = await makeProvider().testConnection();
      expect(result).toEqual({
        ok: false,
        message: 'Resend rejected the configured API key',
      });
    });
  });
});
