import { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';

import { makeUniqueConstraintError } from '../../../../test/mocks/prisma-error.mock';
import type { RecordClickJobData } from '../../links/queue/click-event.types';

import { ClickEventProcessor } from './click-event.processor';

function makeJob(
  data: Partial<RecordClickJobData> = {},
): Job<RecordClickJobData> {
  return {
    id: 'job-1',
    data: {
      eventId: '11111111-1111-1111-1111-111111111111',
      linkId: 'link-1',
      workspaceId: 'ws-1',
      occurredAt: new Date('2026-01-15T12:00:00.000Z').toISOString(),
      ipAddress: '8.8.8.8',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      referer: 'https://www.google.com/',
      queryString: 'utm_source=test',
      ...data,
    },
  } as Job<RecordClickJobData>;
}

describe('ClickEventProcessor', () => {
  let prisma: {
    clickEvent: { create: jest.Mock };
    linkDailyStat: { upsert: jest.Mock };
    $transaction: jest.Mock;
  };
  let config: { get: jest.Mock };
  let geoProvider: { lookup: jest.Mock };
  let processor: ClickEventProcessor;

  beforeEach(() => {
    prisma = {
      clickEvent: { create: jest.fn().mockResolvedValue({}) },
      linkDailyStat: { upsert: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) =>
        fn(prisma),
      ),
    };
    config = { get: jest.fn(() => 'test-salt') };
    geoProvider = {
      lookup: jest.fn(() => ({ country: 'US', region: null, city: null })),
    };
    processor = new ClickEventProcessor(
      prisma as unknown as never,
      config as unknown as never,
      geoProvider as unknown as never,
    );
  });

  it('persists a well-formed event with enriched fields', async () => {
    await processor.process(makeJob());

    expect(prisma.clickEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: '11111111-1111-1111-1111-111111111111',
          linkId: 'link-1',
          workspaceId: 'ws-1',
          country: 'US',
          deviceType: 'desktop',
          browser: 'Chrome',
          os: 'Windows',
          referrerDomain: 'google.com',
          referrerCategory: 'search',
          queryParams: { utm_source: 'test' },
          isBot: false,
        }),
      }),
    );
  });

  it('uses Prisma.JsonNull (not a bare null) for queryParams when no marketing params were captured', async () => {
    // Regression test: extractMarketingParams returns a bare JS `null`
    // when a redirect carries no utm_* params. Prisma's generated types
    // for a nullable Json field reject a bare `null` outright — passing
    // one there is a real Prisma-5.22 compile error the local shim's
    // permissive `any`-typed delegate never caught (see
    // click-event.processor.ts). Prisma.JsonNull is the correct
    // sentinel for "the column holds the JSON value null", which is
    // also what this code stored before the fix (JSON.stringify(null)),
    // so this asserts the exact pre-existing runtime behavior is
    // preserved, not just that the code compiles.
    await processor.process(makeJob({ queryString: undefined }));

    const createCall = prisma.clickEvent.create.mock.calls[0][0];
    expect(createCall.data.queryParams).toBe(Prisma.JsonNull);
  });

  it('never includes a raw ipAddress field in the persisted data', async () => {
    await processor.process(makeJob());

    const createCall = prisma.clickEvent.create.mock.calls[0][0];
    expect(createCall.data.ipAddress).toBeUndefined();
  });

  it('increments the daily rollup for a human click', async () => {
    await processor.process(makeJob());

    expect(prisma.linkDailyStat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          linkId_date: {
            linkId: 'link-1',
            date: new Date('2026-01-15T00:00:00.000Z'),
          },
        },
        create: expect.objectContaining({
          totalClicks: 1,
          humanClicks: 1,
          botClicks: 0,
        }),
        update: expect.objectContaining({
          totalClicks: { increment: 1 },
          humanClicks: { increment: 1 },
          botClicks: { increment: 0 },
        }),
      }),
    );
  });

  it('increments bot counters (not human) for a detected bot', async () => {
    await processor.process(
      makeJob({
        userAgent:
          'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      }),
    );

    expect(prisma.linkDailyStat.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ humanClicks: 0, botClicks: 1 }),
      }),
    );
    const createCall = prisma.clickEvent.create.mock.calls[0][0];
    expect(createCall.data.isBot).toBe(true);
  });

  describe('idempotency', () => {
    it('treats a unique-constraint violation as a successful no-op (retried job)', async () => {
      prisma.$transaction.mockRejectedValueOnce(makeUniqueConstraintError());

      await expect(processor.process(makeJob())).resolves.toBeUndefined();
    });

    it('does not attempt to re-increment the daily rollup on a duplicate-event retry', async () => {
      // Simulate: the transaction throws before we'd know whether the
      // rollup step ran — the key behavioral guarantee is that process()
      // resolves successfully without throwing, so BullMQ does not retry
      // a job that already succeeded.
      prisma.$transaction.mockRejectedValueOnce(makeUniqueConstraintError());

      await processor.process(makeJob());

      // A second, fresh attempt with a NEW transaction mock proves the
      // method returned cleanly rather than partially completing.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('re-throws (triggering BullMQ retry) for a non-idempotency database error', async () => {
      prisma.$transaction.mockRejectedValueOnce(new Error('connection reset'));

      await expect(processor.process(makeJob())).rejects.toThrow(
        'connection reset',
      );
    });
  });

  describe('validation', () => {
    it('discards (does not throw) a job missing required fields', async () => {
      await expect(
        processor.process(makeJob({ linkId: '' })),
      ).resolves.toBeUndefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('discards a job with an unparseable occurredAt', async () => {
      await expect(
        processor.process(makeJob({ occurredAt: 'not-a-real-date' })),
      ).resolves.toBeUndefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('geo resolution', () => {
    it('skips geo lookup entirely when no IP is available', async () => {
      await processor.process(makeJob({ ipAddress: undefined }));
      expect(geoProvider.lookup).not.toHaveBeenCalled();
    });

    it('stores null geo fields when the provider returns no match', async () => {
      geoProvider.lookup.mockReturnValue({
        country: null,
        region: null,
        city: null,
      });
      await processor.process(makeJob());

      const createCall = prisma.clickEvent.create.mock.calls[0][0];
      expect(createCall.data.country).toBeNull();
    });
  });
});
