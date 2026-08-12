import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

describe('Custom Domains (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    redis = testApp.redis;
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(prisma, redis);
  });

  afterAll(async () => {
    await resetDatabase(prisma, redis);
    await app.close();
  }, 30000);

  async function registerUser(email: string) {
    const res = await request(server).post('/api/v1/auth/register').send({
      firstName: 'Test',
      lastName: 'User',
      email,
      password: 'SecurePass123',
      passwordConfirmation: 'SecurePass123',
      termsAccepted: true,
    });
    return {
      accessToken: res.body.accessToken as string,
      userId: res.body.user.id as string,
      workspaceId: res.body.workspaces[0].id as string,
    };
  }

  function headers(actor: { accessToken: string }) {
    return { Authorization: `Bearer ${actor.accessToken}` };
  }

  function createDomain(
    owner: { accessToken: string; workspaceId: string },
    domain: string,
  ) {
    return request(server)
      .post(`/api/v1/workspaces/${owner.workspaceId}/domains`)
      .set(headers(owner))
      .send({ domain });
  }

  async function createLink(
    owner: { accessToken: string; workspaceId: string },
    payload: Record<string, unknown>,
  ) {
    const res = await request(server)
      .post('/api/v1/links')
      .set({ ...headers(owner), 'X-Workspace-Id': owner.workspaceId })
      .send(payload);
    return res;
  }

  /** The mock verification provider (auto-selected under NODE_ENV=test)
   * succeeds iff the normalized hostname starts with "verified-". */
  async function createVerifiedActiveDomain(
    owner: { accessToken: string; workspaceId: string },
    hostname = `verified-${Date.now()}.acme.test`,
  ) {
    const created = await createDomain(owner, hostname);
    await request(server)
      .post(
        `/api/v1/workspaces/${owner.workspaceId}/domains/${created.body.id}/verify`,
      )
      .set(headers(owner));
    const activated = await request(server)
      .post(
        `/api/v1/workspaces/${owner.workspaceId}/domains/${created.body.id}/activate`,
      )
      .set(headers(owner));
    return { domainId: created.body.id as string, hostname, activated };
  }

  describe('CRUD + validation', () => {
    it('creates a domain in PENDING status with verification instructions', async () => {
      const owner = await registerUser('domains1@example.com');
      const res = await createDomain(owner, 'go.acme.com');

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.normalizedDomain).toBe('go.acme.com');
      expect(res.body.verification.recordName).toBe(
        '_linkiq-verification.go.acme.com',
      );
      expect(res.body.verification.recordType).toBe('TXT');
      expect(typeof res.body.verification.recordValue).toBe('string');
    });

    it('rejects a duplicate domain registration (409)', async () => {
      const owner = await registerUser('domains2@example.com');
      await createDomain(owner, 'dup.acme.com').expect(201);

      const res = await createDomain(owner, 'dup.acme.com');
      expect(res.status).toBe(409);
    });

    it('rejects a duplicate domain even from a different workspace', async () => {
      const ownerA = await registerUser('domains3a@example.com');
      const ownerB = await registerUser('domains3b@example.com');
      await createDomain(ownerA, 'shared.acme.com').expect(201);

      const res = await createDomain(ownerB, 'shared.acme.com');
      expect(res.status).toBe(409);
    });

    it('rejects a malformed domain', async () => {
      const owner = await registerUser('domains4@example.com');
      const res = await createDomain(owner, 'not a domain');
      expect(res.status).toBe(400);
    });

    it("lists only the workspace's own domains", async () => {
      const ownerA = await registerUser('domains5a@example.com');
      const ownerB = await registerUser('domains5b@example.com');
      await createDomain(ownerA, 'a.acme.com').expect(201);
      await createDomain(ownerB, 'b.acme.com').expect(201);

      const res = await request(server)
        .get(`/api/v1/workspaces/${ownerA.workspaceId}/domains`)
        .set(headers(ownerA));

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].normalizedDomain).toBe('a.acme.com');
    });
  });

  describe('workspace isolation', () => {
    it('cross-workspace access to a domain by ID returns 404, not 403', async () => {
      const ownerA = await registerUser('iso1a@example.com');
      const ownerB = await registerUser('iso1b@example.com');
      const created = await createDomain(ownerA, 'isolated.acme.com');

      const res = await request(server)
        .get(
          `/api/v1/workspaces/${ownerB.workspaceId}/domains/${created.body.id}`,
        )
        .set(headers(ownerB));

      expect(res.status).toBe(404);
    });

    it('a non-member of the workspace cannot create a domain there (403)', async () => {
      const ownerA = await registerUser('iso2a@example.com');
      const outsider = await registerUser('iso2b@example.com');

      const res = await request(server)
        .post(`/api/v1/workspaces/${ownerA.workspaceId}/domains`)
        .set(headers(outsider))
        .send({ domain: 'blocked.acme.com' });

      expect(res.status).toBe(403);
    });

    it("a non-member cannot verify/activate/disable/delete another workspace's domain", async () => {
      const ownerA = await registerUser('iso3a@example.com');
      const outsider = await registerUser('iso3b@example.com');
      const created = await createDomain(ownerA, 'protected.acme.com');

      const base = `/api/v1/workspaces/${ownerA.workspaceId}/domains/${created.body.id}`;
      await request(server)
        .post(`${base}/verify`)
        .set(headers(outsider))
        .expect(403);
      await request(server)
        .post(`${base}/activate`)
        .set(headers(outsider))
        .expect(403);
      await request(server)
        .post(`${base}/disable`)
        .set(headers(outsider))
        .expect(403);
      await request(server).delete(base).set(headers(outsider)).expect(403);
    });
  });

  describe('verification lifecycle', () => {
    it('successfully verifies a domain whose DNS proof the mock provider recognizes', async () => {
      const owner = await registerUser('verify1@example.com');
      const created = await createDomain(owner, 'verified-example.acme.test');

      const res = await request(server)
        .post(
          `/api/v1/workspaces/${owner.workspaceId}/domains/${created.body.id}/verify`,
        )
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('VERIFIED');
      expect(res.body.verifiedAt).not.toBeNull();
    });

    it('fails verification (and never falsely reports success) when the DNS proof is absent', async () => {
      const owner = await registerUser('verify2@example.com');
      const created = await createDomain(owner, 'unverified-example.acme.test');

      const res = await request(server)
        .post(
          `/api/v1/workspaces/${owner.workspaceId}/domains/${created.body.id}/verify`,
        )
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('FAILED');
      expect(res.body.verifiedAt).toBeNull();
    });

    it('records audit events for verification attempts', async () => {
      const owner = await registerUser('verify3@example.com');
      const created = await createDomain(owner, 'verified-audit.acme.test');
      await request(server)
        .post(
          `/api/v1/workspaces/${owner.workspaceId}/domains/${created.body.id}/verify`,
        )
        .set(headers(owner));

      const actions = (
        await prisma.auditLog.findMany({
          where: { entityId: created.body.id },
          orderBy: { createdAt: 'asc' },
        })
      ).map((a) => a.action);

      expect(actions).toEqual(
        expect.arrayContaining([
          'domain.created',
          'domain.verification_requested',
          'domain.verified',
        ]),
      );
    });
  });

  describe('activate / disable', () => {
    it('rejects activating a domain that has never been verified', async () => {
      const owner = await registerUser('activate1@example.com');
      const created = await createDomain(owner, 'pending.acme.com');

      const res = await request(server)
        .post(
          `/api/v1/workspaces/${owner.workspaceId}/domains/${created.body.id}/activate`,
        )
        .set(headers(owner));

      expect(res.status).toBe(400);
    });

    it('activates a verified domain', async () => {
      const owner = await registerUser('activate2@example.com');
      const { activated } = await createVerifiedActiveDomain(owner);
      expect(activated.status).toBe(200);
      expect(activated.body.status).toBe('ACTIVE');
    });

    it('disables an active domain without deleting its links', async () => {
      const owner = await registerUser('disable1@example.com');
      const { domainId } = await createVerifiedActiveDomain(owner);
      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/x',
        slug: 'disable-link-test',
        customDomainId: domainId,
      });
      expect(link.status).toBe(201);

      const res = await request(server)
        .post(
          `/api/v1/workspaces/${owner.workspaceId}/domains/${domainId}/disable`,
        )
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('DISABLED');

      const stillThere = await prisma.link.findUnique({
        where: { id: link.body.id },
      });
      expect(stillThere).not.toBeNull();
      expect(stillThere?.deletedAt).toBeNull();
    });

    it('rejects disabling a domain that is not active', async () => {
      const owner = await registerUser('disable2@example.com');
      const created = await createDomain(owner, 'notactive.acme.com');

      const res = await request(server)
        .post(
          `/api/v1/workspaces/${owner.workspaceId}/domains/${created.body.id}/disable`,
        )
        .set(headers(owner));

      expect(res.status).toBe(400);
    });
  });

  describe('primary domain', () => {
    it('sets a verified domain as primary', async () => {
      const owner = await registerUser('primary1@example.com');
      const { domainId } = await createVerifiedActiveDomain(owner);

      const res = await request(server)
        .post(
          `/api/v1/workspaces/${owner.workspaceId}/domains/${domainId}/primary`,
        )
        .set(headers(owner));

      expect(res.status).toBe(200);
      expect(res.body.isPrimary).toBe(true);
    });

    it('replacing the primary domain unsets the previous one', async () => {
      const owner = await registerUser('primary2@example.com');
      const first = await createVerifiedActiveDomain(
        owner,
        `verified-first-${Date.now()}.acme.test`,
      );
      const second = await createVerifiedActiveDomain(
        owner,
        `verified-second-${Date.now()}.acme.test`,
      );

      await request(server)
        .post(
          `/api/v1/workspaces/${owner.workspaceId}/domains/${first.domainId}/primary`,
        )
        .set(headers(owner))
        .expect(200);
      await request(server)
        .post(
          `/api/v1/workspaces/${owner.workspaceId}/domains/${second.domainId}/primary`,
        )
        .set(headers(owner))
        .expect(200);

      const firstAfter = await request(server)
        .get(
          `/api/v1/workspaces/${owner.workspaceId}/domains/${first.domainId}`,
        )
        .set(headers(owner));
      const secondAfter = await request(server)
        .get(
          `/api/v1/workspaces/${owner.workspaceId}/domains/${second.domainId}`,
        )
        .set(headers(owner));

      expect(firstAfter.body.isPrimary).toBe(false);
      expect(secondAfter.body.isPrimary).toBe(true);
    });
  });

  describe('link integration', () => {
    it('creates a link with a custom domain and resolves its publicUrl to that domain', async () => {
      const owner = await registerUser('linkdomain1@example.com');
      const { domainId, hostname } = await createVerifiedActiveDomain(owner);

      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/target',
        slug: 'branded-link',
        customDomainId: domainId,
      });

      expect(link.status).toBe(201);
      expect(link.body.customDomainId).toBe(domainId);
      expect(link.body.publicUrl).toBe(`https://${hostname}/branded-link`);
    });

    it('a link created without a custom domain keeps working exactly as before', async () => {
      const owner = await registerUser('linkdomain2@example.com');
      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/target',
        slug: 'plain-link',
      });

      expect(link.status).toBe(201);
      expect(link.body.customDomainId).toBeNull();
      expect(link.body.publicUrl).toBe('http://localhost:3000/plain-link');

      const res = await request(server).get('/plain-link').redirects(0);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://example.com/target');
    });

    it("rejects attaching another workspace's domain to a link (404)", async () => {
      const ownerA = await registerUser('linkdomain3a@example.com');
      const ownerB = await registerUser('linkdomain3b@example.com');
      const { domainId } = await createVerifiedActiveDomain(ownerA);

      const link = await createLink(ownerB, {
        destinationUrl: 'https://example.com/target',
        slug: 'cross-ws-link',
        customDomainId: domainId,
      });

      expect(link.status).toBe(404);
    });

    it('rejects attaching a PENDING (unverified) domain to a link (400)', async () => {
      const owner = await registerUser('linkdomain4@example.com');
      const created = await createDomain(owner, 'pending-select.acme.com');

      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/target',
        slug: 'unverified-domain-link',
        customDomainId: created.body.id,
      });

      expect(link.status).toBe(400);
    });
  });

  describe('custom-domain redirect', () => {
    it('resolves a redirect through the custom domain Host header', async () => {
      const owner = await registerUser('redirect1@example.com');
      const { domainId, hostname } = await createVerifiedActiveDomain(owner);
      await createLink(owner, {
        destinationUrl: 'https://example.com/target',
        slug: 'custom-redirect-1',
        customDomainId: domainId,
      });

      const res = await request(server)
        .get('/custom-redirect-1')
        .set('Host', hostname)
        .redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://example.com/target');
    });

    it('applies UTM parameters on a custom-domain redirect exactly as on the default host', async () => {
      const owner = await registerUser('redirect2@example.com');
      const { domainId, hostname } = await createVerifiedActiveDomain(owner);
      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/target',
        slug: 'custom-redirect-utm',
        customDomainId: domainId,
        utmSource: 'newsletter',
        utmMedium: 'email',
      });
      expect(link.status).toBe(201);

      const res = await request(server)
        .get('/custom-redirect-utm')
        .set('Host', hostname)
        .redirects(0);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        'https://example.com/target?utm_source=newsletter&utm_medium=email',
      );
    });

    it('records a click event for a custom-domain redirect, same as a default-host redirect', async () => {
      const owner = await registerUser('redirect3@example.com');
      const { domainId, hostname } = await createVerifiedActiveDomain(owner);
      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/target',
        slug: 'custom-redirect-click',
        customDomainId: domainId,
      });

      await request(server)
        .get('/custom-redirect-click')
        .set('Host', hostname)
        .redirects(0)
        .expect(302);

      const deadline = Date.now() + 3000;
      let count = 0;
      while (Date.now() < deadline) {
        count = await prisma.clickEvent.count({
          where: { linkId: link.body.id },
        });
        if (count > 0) break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(count).toBe(1);
    });

    it('does not resolve a link through a domain it is not associated with', async () => {
      const owner = await registerUser('redirect4@example.com');
      const domainA = await createVerifiedActiveDomain(
        owner,
        `verified-a-${Date.now()}.acme.test`,
      );
      const domainB = await createVerifiedActiveDomain(
        owner,
        `verified-b-${Date.now()}.acme.test`,
      );
      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/target',
        slug: 'domain-mismatch-link',
        customDomainId: domainA.domainId,
      });
      expect(link.status).toBe(201);

      const res = await request(server)
        .get('/domain-mismatch-link')
        .set('Host', domainB.hostname);

      expect(res.status).toBe(404);
    });

    it('does not resolve any link through an unregistered/unknown hostname', async () => {
      const owner = await registerUser('redirect5@example.com');
      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/target',
        slug: 'unknown-host-link',
      });
      expect(link.status).toBe(201);

      const res = await request(server)
        .get('/unknown-host-link')
        .set('Host', 'totally-unregistered.acme.test');

      expect(res.status).toBe(404);
    });

    it('stops resolving through a domain once it is disabled', async () => {
      const owner = await registerUser('redirect6@example.com');
      const { domainId, hostname } = await createVerifiedActiveDomain(owner);
      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/target',
        slug: 'disabled-domain-link',
        customDomainId: domainId,
      });
      expect(link.status).toBe(201);

      await request(server)
        .get('/disabled-domain-link')
        .set('Host', hostname)
        .redirects(0)
        .expect(302);

      await request(server)
        .post(
          `/api/v1/workspaces/${owner.workspaceId}/domains/${domainId}/disable`,
        )
        .set(headers(owner))
        .expect(200);

      const res = await request(server)
        .get('/disabled-domain-link')
        .set('Host', hostname);
      expect(res.status).toBe(404);
    });
  });

  describe('QR codes with a custom domain', () => {
    it('generates a downloadable QR code for a link with an active custom domain', async () => {
      const owner = await registerUser('qrdomain1@example.com');
      const { domainId } = await createVerifiedActiveDomain(owner);
      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/target',
        slug: 'qr-branded-link',
        customDomainId: domainId,
      });

      const qr = await request(server)
        .post(`/api/v1/links/${link.body.id}/qrcodes`)
        .set({ ...headers(owner), 'X-Workspace-Id': owner.workspaceId })
        .send({ name: 'Branded QR' });
      expect(qr.status).toBe(201);

      const download = await request(server)
        .get(`/api/v1/qrcodes/${qr.body.id}/download`)
        .set({ ...headers(owner), 'X-Workspace-Id': owner.workspaceId });

      expect(download.status).toBe(200);
      expect(download.headers['content-type']).toContain('image/png');
    });
  });

  describe('deleting a domain', () => {
    it('soft-deletes the domain, detaches its links, and the link still functions on the default host', async () => {
      const owner = await registerUser('delete1@example.com');
      const { domainId, hostname } = await createVerifiedActiveDomain(owner);
      const link = await createLink(owner, {
        destinationUrl: 'https://example.com/target',
        slug: 'delete-domain-link',
        customDomainId: domainId,
      });

      await request(server)
        .delete(`/api/v1/workspaces/${owner.workspaceId}/domains/${domainId}`)
        .set(headers(owner))
        .expect(204);

      const linkAfter = await prisma.link.findUnique({
        where: { id: link.body.id },
      });
      expect(linkAfter).not.toBeNull();
      expect(linkAfter?.deletedAt).toBeNull();
      expect(linkAfter?.customDomainId).toBeNull();

      // The default host still redirects — link availability is entirely
      // unaffected by its (now detached) domain having been deleted.
      const res = await request(server).get('/delete-domain-link').redirects(0);
      expect(res.status).toBe(302);

      // The deleted domain's own hostname no longer resolves anything.
      const viaOldHost = await request(server)
        .get('/delete-domain-link')
        .set('Host', hostname);
      expect(viaOldHost.status).toBe(404);
    });
  });
});
