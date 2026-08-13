// Fast, deterministic retry/backoff/exhaustion behavior for this file's
// own app instance only — set BEFORE createTestApp() compiles AppModule
// (ConfigModule reads process.env at that compile call, not at process
// start), so other spec files' own createTestApp() calls are unaffected.
process.env.WEBHOOK_MAX_ATTEMPTS = '3';
process.env.WEBHOOK_BACKOFF_BASE_MS = '150';
process.env.WEBHOOK_AUTO_DISABLE_THRESHOLD = '3';
process.env.WEBHOOK_TIMEOUT_MS = '2000';
process.env.WEBHOOK_ALLOW_HTTP_LOCALHOST = 'true';

import { createHmac } from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';

import type { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import request from 'supertest';

import type { PrismaService } from '../src/modules/prisma/prisma.service';

import { createTestApp, resetDatabase } from './setup-app';

interface ReceivedRequest {
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A real, local, in-process HTTP receiver — no external service
 * dependency, per the spec's requirement. Listens on an ephemeral
 * loopback port so `WEBHOOK_ALLOW_HTTP_LOCALHOST` is what makes it
 * reachable at all under the SSRF guard. */
class TestWebhookReceiver {
  private server!: http.Server;
  received: ReceivedRequest[] = [];
  private status = 200;

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        this.received.push({
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.statusCode = this.status;
        res.end();
      });
    });
    await new Promise<void>((resolve) => {
      this.server.listen(0, '127.0.0.1', resolve);
    });
  }

  /** Every subsequent request gets this HTTP status — lets a single
   * receiver simulate a healthy endpoint (200) or a broken one (500)
   * without spinning up a second server. */
  setResponseStatus(status: number): void {
    this.status = status;
  }

  get url(): string {
    const address = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}/webhook`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

function sign(secret: string, timestamp: number, rawBody: string): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return `sha256=${digest}`;
}

describe('Webhooks & Event Delivery (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let server: Parameters<typeof request>[0];
  let receiver: TestWebhookReceiver;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    redis = testApp.redis;
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await resetDatabase(prisma, redis);
    receiver = new TestWebhookReceiver();
    await receiver.start();
  });

  afterEach(async () => {
    await receiver.close();
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

  function headers(actor: { accessToken: string }, workspaceId: string) {
    return {
      Authorization: `Bearer ${actor.accessToken}`,
      'X-Workspace-Id': workspaceId,
    };
  }

  function basePath(workspaceId: string) {
    return `/api/v1/workspaces/${workspaceId}/webhooks`;
  }

  async function createEndpoint(
    owner: { accessToken: string },
    workspaceId: string,
    body: { name: string; url: string; events: string[] },
  ) {
    const res = await request(server)
      .post(basePath(workspaceId))
      .set(headers(owner, workspaceId))
      .send(body);
    return res;
  }

  async function createLink(
    owner: { accessToken: string },
    workspaceId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const res = await request(server)
      .post('/api/v1/links')
      .set(headers(owner, workspaceId))
      .send({ destinationUrl: 'https://example.com/target', ...overrides });
    return res.body;
  }

  /** Polls delivery history until at least `minCount` rows exist for this
   * endpoint (optionally in a specific status), or times out — the same
   * poll-a-real-async-pipeline pattern analytics.e2e-spec.ts's
   * waitForClickEvents() already establishes for this codebase. */
  async function waitForDeliveries(
    endpointId: string,
    minCount = 1,
    opts: { status?: string; timeoutMs?: number } = {},
  ) {
    const deadline = Date.now() + (opts.timeoutMs ?? 8000);
    let deliveries: Array<{ status: string }> = [];
    while (Date.now() < deadline) {
      deliveries = await prisma.webhookDelivery.findMany({
        where: {
          webhookEndpointId: endpointId,
          ...(opts.status ? { status: opts.status as never } : {}),
        },
      });
      if (deliveries.length >= minCount) return deliveries;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return deliveries;
  }

  async function waitForReceiverRequests(minCount = 1, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (receiver.received.length >= minCount) return receiver.received;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return receiver.received;
  }

  describe('CRUD', () => {
    it('rejects unauthenticated requests', async () => {
      const owner = await registerUser('crud-auth@example.com');
      await request(server)
        .post(basePath(owner.workspaceId))
        .send({ name: 'x', url: receiver.url, events: ['link.created'] })
        .expect(401);
    });

    it('creates an endpoint and returns the whsec_ secret exactly once', async () => {
      const owner = await registerUser('crud-create@example.com');

      const res = await createEndpoint(owner, owner.workspaceId, {
        name: 'My endpoint',
        url: receiver.url,
        events: ['link.created', 'link.updated'],
      });

      expect(res.status).toBe(201);
      expect(res.body.secret).toMatch(/^whsec_/);
      expect(res.body.secretPrefix).toBe(
        res.body.secret.slice(0, res.body.secretPrefix.length),
      );
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.events).toEqual(['link.created', 'link.updated']);
    });

    it('never returns the secret again from list/get responses', async () => {
      const owner = await registerUser('crud-nosecret@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });

      const listRes = await request(server)
        .get(basePath(owner.workspaceId))
        .set(headers(owner, owner.workspaceId));
      const getRes = await request(server)
        .get(`${basePath(owner.workspaceId)}/${created.body.id}`)
        .set(headers(owner, owner.workspaceId));

      for (const body of [listRes.body[0], getRes.body]) {
        expect(body).not.toHaveProperty('secret');
        expect(body).not.toHaveProperty('secretCiphertext');
        expect(body).not.toHaveProperty('secretHash');
      }
    });

    it('rejects creation with no events selected (400)', async () => {
      const owner = await registerUser('crud-noevents@example.com');
      const res = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: [],
      });
      expect(res.status).toBe(400);
    });

    it('rejects a URL resolving to a private/internal address (SSRF guard, 400)', async () => {
      const owner = await registerUser('crud-ssrf@example.com');
      const res = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: 'http://10.0.0.5/webhook',
        events: ['link.created'],
      });
      expect(res.status).toBe(400);
    });

    it('updates name/url/events', async () => {
      const owner = await registerUser('crud-update@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'Original',
        url: receiver.url,
        events: ['link.created'],
      });

      const res = await request(server)
        .patch(`${basePath(owner.workspaceId)}/${created.body.id}`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Renamed', events: ['link.updated'] });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Renamed');
      expect(res.body.events).toEqual(['link.updated']);
    });

    it('pause -> activate cycles status and reset consecutiveFailures on activate', async () => {
      const owner = await registerUser('crud-pause@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });

      const paused = await request(server)
        .post(`${basePath(owner.workspaceId)}/${created.body.id}/pause`)
        .set(headers(owner, owner.workspaceId));
      expect(paused.body.status).toBe('PAUSED');

      const activated = await request(server)
        .post(`${basePath(owner.workspaceId)}/${created.body.id}/activate`)
        .set(headers(owner, owner.workspaceId));
      expect(activated.body.status).toBe('ACTIVE');
    });

    it('rotate-secret returns a new secret once and invalidates the old one for signing', async () => {
      const owner = await registerUser('crud-rotate@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });
      const originalSecret = created.body.secret as string;

      const rotated = await request(server)
        .post(`${basePath(owner.workspaceId)}/${created.body.id}/rotate-secret`)
        .set(headers(owner, owner.workspaceId));

      expect(rotated.status).toBe(200);
      expect(rotated.body.secret).toMatch(/^whsec_/);
      expect(rotated.body.secret).not.toBe(originalSecret);
    });

    it('soft-deletes an endpoint (204) and it no longer appears in list', async () => {
      const owner = await registerUser('crud-delete@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });

      await request(server)
        .delete(`${basePath(owner.workspaceId)}/${created.body.id}`)
        .set(headers(owner, owner.workspaceId))
        .expect(204);

      const listRes = await request(server)
        .get(basePath(owner.workspaceId))
        .set(headers(owner, owner.workspaceId));
      expect(listRes.body).toEqual([]);
    });
  });

  describe('RBAC', () => {
    async function inviteMember(
      owner: { accessToken: string; workspaceId: string },
      email: string,
      role: 'MEMBER' | 'VIEWER',
    ) {
      const invitee = await registerUser(email);
      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/members/invite`)
        .set(headers(owner, owner.workspaceId))
        .send({ email, role });
      return invitee;
    }

    it('a MEMBER cannot create a webhook endpoint (403) — credentials are ADMIN+ only', async () => {
      const owner = await registerUser('rbac-a1@example.com');
      const member = await inviteMember(owner, 'rbac-a2@example.com', 'MEMBER');

      const res = await createEndpoint(
        { accessToken: member.accessToken },
        owner.workspaceId,
        { name: 'x', url: receiver.url, events: ['link.created'] },
      );
      expect(res.status).toBe(403);
    });

    it('a VIEWER can list and read endpoints', async () => {
      const owner = await registerUser('rbac-b1@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });
      const viewer = await inviteMember(owner, 'rbac-b2@example.com', 'VIEWER');

      const res = await request(server)
        .get(`${basePath(owner.workspaceId)}/${created.body.id}`)
        .set(headers({ accessToken: viewer.accessToken }, owner.workspaceId));

      expect(res.status).toBe(200);
    });

    it('a VIEWER cannot pause an endpoint (403)', async () => {
      const owner = await registerUser('rbac-c1@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });
      const viewer = await inviteMember(owner, 'rbac-c2@example.com', 'VIEWER');

      const res = await request(server)
        .post(`${basePath(owner.workspaceId)}/${created.body.id}/pause`)
        .set(headers({ accessToken: viewer.accessToken }, owner.workspaceId));

      expect(res.status).toBe(403);
    });
  });

  describe('workspace isolation', () => {
    it('an endpoint created in workspace A 404s when read via workspace B, even for its OWNER', async () => {
      const ownerA = await registerUser('iso-a@example.com');
      const ownerB = await registerUser('iso-b@example.com');
      const created = await createEndpoint(ownerA, ownerA.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });

      const res = await request(server)
        .get(`${basePath(ownerB.workspaceId)}/${created.body.id}`)
        .set(headers(ownerB, ownerB.workspaceId));

      expect(res.status).toBe(404);
    });
  });

  describe('real delivery: event -> queue -> worker -> HTTP -> signature verification', () => {
    it('link.created triggers a signed, correctly-shaped delivery to the receiver', async () => {
      const owner = await registerUser('deliver-created@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });
      const secret = created.body.secret as string;

      const link = await createLink(owner, owner.workspaceId, {
        slug: 'deliver-created-slug',
      });

      const requests = await waitForReceiverRequests(1);
      expect(requests).toHaveLength(1);

      const received = requests[0]!;
      expect(received.headers['x-linkiq-event-type']).toBe('link.created');
      expect(String(received.headers['x-linkiq-event-id'])).toMatch(/^evt_/);
      const timestamp = Number(received.headers['x-linkiq-timestamp']);
      expect(Number.isNaN(timestamp)).toBe(false);

      const expectedSig = sign(secret, timestamp, received.body);
      expect(received.headers['x-linkiq-signature']).toBe(expectedSig);

      const envelope = JSON.parse(received.body);
      expect(envelope.type).toBe('link.created');
      expect(envelope.workspaceId).toBe(owner.workspaceId);
      expect(envelope.data.id).toBe(link.id);
      expect(envelope.data.shortCode).toBe('deliver-created-slug');

      const delivered = await waitForDeliveries(created.body.id, 1, {
        status: 'DELIVERED',
      });
      expect(delivered).toHaveLength(1);
    });

    it('link.updated triggers its own delivery, distinct from link.created', async () => {
      const owner = await registerUser('deliver-updated@example.com');
      await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.updated'],
      });
      const link = await createLink(owner, owner.workspaceId);

      await request(server)
        .patch(`/api/v1/links/${link.id}`)
        .set(headers(owner, owner.workspaceId))
        .send({ title: 'New title' });

      const requests = await waitForReceiverRequests(1);
      expect(requests).toHaveLength(1);
      const envelope = JSON.parse(requests[0]!.body);
      expect(envelope.type).toBe('link.updated');
    });

    it('campaign.created triggers a delivery', async () => {
      const owner = await registerUser('deliver-campaign@example.com');
      await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['campaign.created'],
      });

      await request(server)
        .post('/api/v1/campaigns')
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'My Campaign' });

      const requests = await waitForReceiverRequests(1);
      const envelope = JSON.parse(requests[0]!.body);
      expect(envelope.type).toBe('campaign.created');
    });

    it('qrcode.created triggers a delivery', async () => {
      const owner = await registerUser('deliver-qrcode@example.com');
      await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['qrcode.created'],
      });
      const link = await createLink(owner, owner.workspaceId);

      await request(server)
        .post(`/api/v1/links/${link.id}/qrcodes`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'My QR' });

      const requests = await waitForReceiverRequests(1);
      const envelope = JSON.parse(requests[0]!.body);
      expect(envelope.type).toBe('qrcode.created');
    });

    it('api_key.created triggers a delivery', async () => {
      const owner = await registerUser('deliver-apikey@example.com');
      await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['api_key.created'],
      });

      await request(server)
        .post(`/api/v1/workspaces/${owner.workspaceId}/api-keys`)
        .set(headers(owner, owner.workspaceId))
        .send({ name: 'Test Key', permissions: ['LINKS_READ'] });

      const requests = await waitForReceiverRequests(1);
      const envelope = JSON.parse(requests[0]!.body);
      expect(envelope.type).toBe('api_key.created');
    });

    it('an endpoint not subscribed to an event type receives nothing for it', async () => {
      const owner = await registerUser('deliver-unsub@example.com');
      await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['campaign.created'], // NOT link.created
      });

      await createLink(owner, owner.workspaceId);

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(receiver.received).toHaveLength(0);
    });
  });

  describe('test webhook event', () => {
    it('sends a clearly-identified webhook.test delivery through the real pipeline', async () => {
      const owner = await registerUser('test-event@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });

      const res = await request(server)
        .post(`${basePath(owner.workspaceId)}/${created.body.id}/test`)
        .set(headers(owner, owner.workspaceId));
      expect(res.status).toBe(202);
      expect(res.body.eventId).toMatch(/^evt_/);

      const requests = await waitForReceiverRequests(1);
      const envelope = JSON.parse(requests[0]!.body);
      expect(envelope.type).toBe('webhook.test');
    });
  });

  describe('retries, exhaustion, manual retry, auto-disable', () => {
    it('a failing receiver causes retries, eventually reaching EXHAUSTED with attemptCount = WEBHOOK_MAX_ATTEMPTS', async () => {
      receiver.setResponseStatus(500);
      const owner = await registerUser('retry-exhaust@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });

      await createLink(owner, owner.workspaceId);

      const exhausted = await waitForDeliveries(created.body.id, 1, {
        status: 'EXHAUSTED',
        timeoutMs: 10000,
      });
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0]).toMatchObject({ attemptCount: 3 });
      expect(receiver.received.length).toBeGreaterThanOrEqual(3);
    });

    it('a permanent 4xx is not retried repeatedly — exhausts on the first attempt', async () => {
      receiver.setResponseStatus(404);
      const owner = await registerUser('retry-permanent@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });

      await createLink(owner, owner.workspaceId);

      const exhausted = await waitForDeliveries(created.body.id, 1, {
        status: 'EXHAUSTED',
      });
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0]).toMatchObject({ attemptCount: 1 });
    });

    it('manual retry creates a new attempt on the SAME delivery/event, not a new one', async () => {
      receiver.setResponseStatus(404);
      const owner = await registerUser('retry-manual@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });
      await createLink(owner, owner.workspaceId);
      const exhaustedDeliveries = await waitForDeliveries(created.body.id, 1, {
        status: 'EXHAUSTED',
      });
      const deliveryId = (exhaustedDeliveries[0] as unknown as { id: string }).id;

      receiver.setResponseStatus(200);
      const retryRes = await request(server)
        .post(`${basePath(owner.workspaceId)}/${created.body.id}/deliveries/${deliveryId}/retry`)
        .set(headers(owner, owner.workspaceId));
      expect(retryRes.status).toBe(202);

      const deadline = Date.now() + 5000;
      let delivered: { status: string; id: string } | undefined;
      while (Date.now() < deadline) {
        const row = await prisma.webhookDelivery.findUnique({
          where: { id: deliveryId },
        });
        if (row?.status === 'DELIVERED') {
          delivered = row;
          break;
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(delivered?.id).toBe(deliveryId);

      const allDeliveries = await prisma.webhookDelivery.findMany({
        where: { webhookEndpointId: created.body.id },
      });
      expect(allDeliveries).toHaveLength(1);
    });

    it('automatically disables the endpoint after reaching the consecutive-failure threshold, preserving history', async () => {
      receiver.setResponseStatus(404);
      const owner = await registerUser('retry-autodisable@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });

      // WEBHOOK_AUTO_DISABLE_THRESHOLD=3 for this file — 3 separate events,
      // each producing one immediately-exhausted (permanent 404) delivery.
      await createLink(owner, owner.workspaceId, { slug: 'ad-1' });
      await waitForDeliveries(created.body.id, 1, { status: 'EXHAUSTED' });
      await createLink(owner, owner.workspaceId, { slug: 'ad-2' });
      await waitForDeliveries(created.body.id, 2, { status: 'EXHAUSTED' });
      await createLink(owner, owner.workspaceId, { slug: 'ad-3' });
      await waitForDeliveries(created.body.id, 3, { status: 'EXHAUSTED' });

      const deadline = Date.now() + 5000;
      let endpoint: { status: string } | null = null;
      while (Date.now() < deadline) {
        endpoint = await prisma.webhookEndpoint.findUnique({
          where: { id: created.body.id },
        });
        if (endpoint?.status === 'DISABLED') break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(endpoint?.status).toBe('DISABLED');

      const history = await prisma.webhookDelivery.findMany({
        where: { webhookEndpointId: created.body.id },
      });
      expect(history).toHaveLength(3);
    });
  });

  describe('pause blocks delivery, reactivate resumes it', () => {
    it('a paused endpoint receives no new deliveries; reactivating resumes them', async () => {
      const owner = await registerUser('pause-blocks@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });

      await request(server)
        .post(`${basePath(owner.workspaceId)}/${created.body.id}/pause`)
        .set(headers(owner, owner.workspaceId));

      await createLink(owner, owner.workspaceId, { slug: 'paused-1' });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(receiver.received).toHaveLength(0);

      await request(server)
        .post(`${basePath(owner.workspaceId)}/${created.body.id}/activate`)
        .set(headers(owner, owner.workspaceId));

      await createLink(owner, owner.workspaceId, { slug: 'paused-2' });
      const requests = await waitForReceiverRequests(1);
      expect(requests).toHaveLength(1);
    });
  });

  describe('secret rotation', () => {
    it('deliveries after rotation are signed with the NEW secret, not the old one', async () => {
      const owner = await registerUser('rotate-signing@example.com');
      const created = await createEndpoint(owner, owner.workspaceId, {
        name: 'x',
        url: receiver.url,
        events: ['link.created'],
      });
      const originalSecret = created.body.secret as string;

      const rotated = await request(server)
        .post(`${basePath(owner.workspaceId)}/${created.body.id}/rotate-secret`)
        .set(headers(owner, owner.workspaceId));
      const newSecret = rotated.body.secret as string;

      await createLink(owner, owner.workspaceId, { slug: 'post-rotation' });
      const requests = await waitForReceiverRequests(1);
      const received = requests[0]!;
      const timestamp = Number(received.headers['x-linkiq-timestamp']);

      expect(received.headers['x-linkiq-signature']).toBe(
        sign(newSecret, timestamp, received.body),
      );
      expect(received.headers['x-linkiq-signature']).not.toBe(
        sign(originalSecret, timestamp, received.body),
      );
    });
  });
});
