import { NullEmailProvider } from './null-email-provider';

describe('NullEmailProvider', () => {
  it('never sends and reports disabled', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const provider = new NullEmailProvider();

    const result = await provider.send({
      to: 'a@b.com',
      subject: 's',
      html: 'h',
    });

    expect(result).toEqual({
      success: false,
      retryable: false,
      errorMessage: 'Email service is disabled by an administrator',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports disabled on testConnection without a network call', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const result = await new NullEmailProvider().testConnection();
    expect(result).toEqual({ ok: false, message: 'Email service is disabled' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
