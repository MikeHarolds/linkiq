import { Module } from '@nestjs/common';

import { DomainsModule } from '../domains/domains.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

import { LinkSourceController } from './link-source.controller';
import { LinkSourcesController } from './link-sources.controller';
import { LinkSourcesService } from './link-sources.service';

/**
 * Explicit Link Source / Campaign Attribution — see LinkSource in
 * schema.prisma for the full rationale (WhatsApp/Facebook stripping
 * Referer for organic app shares) and LinkSourcesService for the CRUD
 * side. The actual attribution resolution at click time lives in
 * AnalyticsModule's ClickEventProcessor, not here — this module only
 * owns tracking sources as a resource (create/list/update/delete).
 */
@Module({
  imports: [DomainsModule, WebhooksModule],
  controllers: [LinkSourcesController, LinkSourceController],
  providers: [LinkSourcesService],
  exports: [LinkSourcesService],
})
export class LinkSourcesModule {}
