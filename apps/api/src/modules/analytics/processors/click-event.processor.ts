import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WebhookEventType } from '@prisma/client';
import type { Job } from 'bullmq';

import { isUniqueConstraintViolation } from '../../../common/utils/prisma-errors';
import { normalizeSourceKey } from '../../link-sources/utils/normalize-source-key';
import {
  CLICK_EVENT_QUEUE,
  type RecordClickJobData,
} from '../../links/queue/click-event.types';
import { PrismaService } from '../../prisma/prisma.service';
import { WebhookEventsService } from '../../webhooks/webhook-events.service';
import {
  GEO_IP_PROVIDER,
  type GeoIpProvider,
} from '../geo/geo-ip-provider.interface';
import { resolveAttribution } from '../utils/attribution-resolver';
import {
  classifyReferrer,
  extractMarketingParams,
} from '../utils/referrer-classifier';
import { parseUserAgent } from '../utils/user-agent-parser';
import { computeVisitorHash } from '../utils/visitor-hash';

/**
 * Consumes click events off the queue, enriches them (bot detection, UA
 * parsing, geo lookup, referrer classification), and persists them. This
 * is the ONLY place ClickEvent rows are created — deliberately kept out
 * of the request/response cycle of a redirect (see
 * links/queue/click-event.producer.ts) so a slow or failing worker has
 * zero effect on redirect latency or success.
 *
 * Idempotency: `job.data.eventId` is used as the ClickEvent primary key.
 * If this job is retried (crash mid-processing, transient DB error, ...),
 * the insert attempt fails on the unique constraint instead of creating a
 * duplicate row — caught and treated as a successful no-op, including
 * skipping the daily-rollup increment (which already happened on the
 * original successful attempt).
 *
 * Also where Explicit Link Source / Campaign Attribution resolves —
 * see resolveAttribution's own doc comment for the full priority
 * cascade. referrerUrl/referrerDomain/referrerCategory below are Sprint
 * 13's original fields, always computed exactly as before, completely
 * independent of that resolution.
 */
@Processor(CLICK_EVENT_QUEUE, {
  // Bursty by nature (redirects happen in real time); a small concurrency
  // keeps worst-case DB connection usage bounded without serializing
  // every event through one connection.
  concurrency: 5,
})
@Injectable()
export class ClickEventProcessor extends WorkerHost {
  private readonly logger = new Logger(ClickEventProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(GEO_IP_PROVIDER) private readonly geoProvider: GeoIpProvider,
    private readonly webhookEvents: WebhookEventsService,
  ) {
    super();
  }

  async process(job: Job<RecordClickJobData>): Promise<void> {
    const {
      eventId,
      linkId,
      workspaceId,
      occurredAt,
      ipAddress,
      userAgent,
      referer,
      queryString,
    } = job.data;

    // --- Validate -----------------------------------------------------
    if (!eventId || !linkId || !workspaceId) {
      // Malformed job data is not retryable — failing it permanently
      // (rather than throwing, which would trigger retries) avoids
      // burning through the retry budget on data that will never become
      // valid. Log loudly since this indicates a producer-side bug.
      this.logger.error(
        `Discarding malformed click event job ${job.id}: missing required fields`,
      );
      return;
    }

    const occurredAtDate = new Date(occurredAt);
    if (Number.isNaN(occurredAtDate.getTime())) {
      this.logger.error(
        `Discarding click event ${eventId}: invalid occurredAt "${occurredAt}"`,
      );
      return;
    }

    // --- Normalize / classify (pure, fast, no I/O) ---------------------
    const ua = parseUserAgent(userAgent);
    const referrer = classifyReferrer(referer);
    const queryParams = extractMarketingParams(queryString);
    const salt = this.config.get<string>('analytics.visitorHashSalt')!;
    const visitorHash = computeVisitorHash(
      ipAddress ?? 'unknown',
      userAgent ?? 'unknown',
      occurredAtDate,
      salt,
    );

    // --- Geo lookup (never throws; degrades to Unknown) ----------------
    const geo = ipAddress
      ? this.geoProvider.lookup(ipAddress)
      : { country: null, region: null, city: null };

    // --- Explicit Link Source / Campaign Attribution -------------------
    // Tier 1 of the priority cascade (explicit source > UTM > Referer >
    // Direct) — see resolveAttribution's own doc comment. Only a single
    // extra indexed lookup (linkId + source, both indexed — see
    // LinkSource in schema.prisma), and only when utm_source is present
    // at all; this stays off the redirect hot path either way, since
    // this whole method already runs asynchronously.
    const rawSource = queryParams?.utm_source;
    const matchedSource = rawSource
      ? await this.prisma.linkSource.findFirst({
          where: {
            linkId,
            source: normalizeSourceKey(rawSource),
            isActive: true,
            deletedAt: null,
          },
          select: { id: true, source: true, medium: true, campaign: true },
        })
      : null;
    const attribution = resolveAttribution(matchedSource, queryParams, referrer);

    // --- Persist idempotently + update the daily rollup ---------------
    const utcDay = new Date(
      Date.UTC(
        occurredAtDate.getUTCFullYear(),
        occurredAtDate.getUTCMonth(),
        occurredAtDate.getUTCDate(),
      ),
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.clickEvent.create({
          data: {
            id: eventId,
            linkId,
            workspaceId,
            occurredAt: occurredAtDate,
            visitorHash,
            country: geo.country,
            region: geo.region,
            city: geo.city,
            deviceType: ua.deviceType,
            os: ua.os,
            browser: ua.browser,
            userAgent: userAgent?.slice(0, 512),
            referrerUrl: referrer.url,
            referrerDomain: referrer.domain,
            referrerCategory: referrer.category,
            queryParams: queryParams ?? Prisma.JsonNull,
            linkSourceId: attribution.linkSourceId,
            attributedSource: attribution.attributedSource,
            attributedMedium: attribution.attributedMedium,
            attributedCampaign: attribution.attributedCampaign,
            attributionType: attribution.attributionType,
            isBot: ua.isBot,
          },
        });

        await tx.linkDailyStat.upsert({
          where: { linkId_date: { linkId, date: utcDay } },
          create: {
            linkId,
            workspaceId,
            date: utcDay,
            totalClicks: 1,
            humanClicks: ua.isBot ? 0 : 1,
            botClicks: ua.isBot ? 1 : 0,
          },
          update: {
            totalClicks: { increment: 1 },
            humanClicks: { increment: ua.isBot ? 0 : 1 },
            botClicks: { increment: ua.isBot ? 1 : 0 },
          },
        });
      });

      this.logger.log(
        {
          eventId,
          linkId,
          isBot: ua.isBot,
          country: geo.country,
          attributionType: attribution.attributionType,
        },
        'Click event processed',
      );

      // Fully off the redirect hot path — this runs inside the async
      // click-processing worker, well after RedirectService has already
      // responded. Only privacy-filtered fields already used for
      // analytics display (never the raw IP or visitorHash) — see
      // docs/architecture/webhooks.md's click-event privacy section.
      await this.webhookEvents.emit({
        type: WebhookEventType.LINK_CLICKED,
        workspaceId,
        resourceId: linkId,
        data: {
          eventId,
          linkId,
          occurredAt: occurredAtDate.toISOString(),
          country: geo.country,
          region: geo.region,
          city: geo.city,
          deviceType: ua.deviceType,
          os: ua.os,
          browser: ua.browser,
          referrerDomain: referrer.domain,
          referrerCategory: referrer.category,
          attributedSource: attribution.attributedSource,
          attributedMedium: attribution.attributedMedium,
          attributionType: attribution.attributionType,
          isBot: ua.isBot,
        },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // Already processed by a prior attempt at this same job — a
        // successful no-op, not a failure. Do NOT touch the daily
        // rollup again; it was already incremented the first time.
        this.logger.log(
          `Click event ${eventId} already processed — skipping (idempotent retry)`,
        );
        return;
      }
      this.logger.error(
        `Failed to process click event ${eventId}: ${String(error)}`,
      );
      throw error; // let BullMQ apply its retry/backoff policy
    }
  }
}
