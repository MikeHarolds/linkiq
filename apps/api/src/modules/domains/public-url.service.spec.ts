import { DomainStatus } from '@prisma/client';

import { PublicUrlService } from './public-url.service';

// APP_URL is read once at module load (matching the existing
// qr-codes.service.ts convention), so these assertions rely on the
// default fallback rather than mutating process.env at test time.
describe('PublicUrlService', () => {
  it('falls back to APP_URL when no custom domain is given', () => {
    const service = new PublicUrlService();
    expect(service.build('abc123')).toBe('http://localhost:3000/abc123');
  });

  it('falls back to APP_URL when the custom domain is explicitly null', () => {
    const service = new PublicUrlService();
    expect(service.build('abc123', null)).toBe('http://localhost:3000/abc123');
  });

  it('uses the custom domain when it is ACTIVE', () => {
    const service = new PublicUrlService();
    const url = service.build('abc123', {
      normalizedDomain: 'go.acme.com',
      status: DomainStatus.ACTIVE,
    });
    expect(url).toBe('https://go.acme.com/abc123');
  });

  it.each([
    DomainStatus.PENDING,
    DomainStatus.VERIFYING,
    DomainStatus.VERIFIED,
    DomainStatus.FAILED,
    DomainStatus.DISABLED,
  ])(
    'falls back to APP_URL when the custom domain status is %s (not ACTIVE)',
    (status) => {
      const service = new PublicUrlService();
      const url = service.build('abc123', {
        normalizedDomain: 'go.acme.com',
        status,
      });
      expect(url).toBe('http://localhost:3000/abc123');
    },
  );
});
