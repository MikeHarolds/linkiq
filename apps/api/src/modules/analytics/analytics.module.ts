import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { CLICK_EVENT_QUEUE } from '../links/queue/click-event.types';
import { WebhooksModule } from '../webhooks/webhooks.module';

import { AnalyticsCacheService } from './analytics-cache.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { GEO_IP_PROVIDER } from './geo/geo-ip-provider.interface';
import { GeoipCountryProvider } from './geo/geoip-country.provider';
import { NullGeoIpProvider } from './geo/null-geo.provider';
import { ClickEventProcessor } from './processors/click-event.processor';

/**
 * Owns the analytics READ side (AnalyticsService/Controller) and the
 * click-event WORKER (ClickEventProcessor). The WRITE/enqueue side
 * (ClickEventProducer) lives in LinksModule, since dispatching a click
 * event is part of handling a redirect, a Links concern — both modules
 * register the same BullMQ queue name, which is the standard, documented
 * pattern for splitting a queue's producer and consumer across modules.
 *
 * GEO_IP_PROVIDER is swappable via GEO_IP_PROVIDER=none to disable
 * geographic resolution entirely (falls back to NullGeoIpProvider,
 * always "Unknown") without touching any other code — see
 * geo/geo-ip-provider.interface.ts.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: CLICK_EVENT_QUEUE }),
    WebhooksModule,
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsCacheService,
    ClickEventProcessor,
    {
      provide: GEO_IP_PROVIDER,
      useClass:
        process.env.GEO_IP_PROVIDER === 'none'
          ? NullGeoIpProvider
          : GeoipCountryProvider,
    },
  ],
  exports: [AnalyticsService, AnalyticsCacheService],
})
export class AnalyticsModule {}
