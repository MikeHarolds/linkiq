import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { BillingModule } from '../billing/billing.module';
import { DomainsModule } from '../domains/domains.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

import { LinkCacheService } from './link-cache.service';
import { LinksController } from './links.controller';
import { LinksService } from './links.service';
import { ClickEventProducer } from './queue/click-event.producer';
import { CLICK_EVENT_QUEUE } from './queue/click-event.types';
import { RedirectService } from './redirect.service';

/**
 * The Link Management Engine.
 *
 * Redirect flow (the hot path — see redirect.service.ts):
 *   request -> short code -> Redis lookup -> DB fallback (on miss)
 *   -> validate link state -> cache result -> redirect -> enqueue click
 *      event (async, never blocks the response)
 *
 * The public redirect route itself is NOT a Nest controller — see
 * redirect-route.ts for why (Nest's setGlobalPrefix `exclude` option
 * doesn't compose safely with a param-style route). RedirectService is
 * still a normal provider here so it participates in DI; main.ts fetches
 * it via `app.get(RedirectService)` and wires the raw route after the
 * module tree is built.
 *
 * The click event queue is registered here on the PRODUCER side only
 * (ClickEventProducer, used by RedirectService to enqueue clicks) — the
 * CONSUMER side (ClickEventProcessor, which enriches and persists them)
 * lives in AnalyticsModule, which registers the same queue name
 * independently. See analytics.module.ts's docs for why that split is
 * the standard BullMQ+Nest pattern rather than a workaround.
 *
 * BillingModule is imported for LinksService's MAX_LINKS check on
 * `create` only (Sprint 7) — RedirectService deliberately never injects
 * BillingUsageService, keeping the redirect hot path fully independent
 * of billing, per docs/architecture/billing.md.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: CLICK_EVENT_QUEUE }),
    BillingModule,
    DomainsModule,
    WebhooksModule,
  ],
  controllers: [LinksController],
  providers: [
    LinksService,
    LinkCacheService,
    RedirectService,
    ClickEventProducer,
  ],
  exports: [LinksService, RedirectService],
})
export class LinksModule {}
