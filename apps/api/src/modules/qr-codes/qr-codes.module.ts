import { Module } from '@nestjs/common';

import { BillingModule } from '../billing/billing.module';
import { DomainsModule } from '../domains/domains.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

import { LinkQrCodesController } from './link-qr-codes.controller';
import { QrCodesController } from './qr-codes.controller';
import { QrCodesService } from './qr-codes.service';
import { QrGeneratorService } from './qr-generator.service';

/**
 * The QR Code Engine.
 *
 * QR codes always encode an existing link's short URL, never a
 * destinationUrl directly (see QrCodesService.buildEncodedUrl) — this is
 * what lets a link's destination change at any time without invalidating
 * or needing to regenerate any QR code pointing at it.
 *
 * No separate scan-tracking pipeline exists: a QR scan is, from the
 * server's perspective, an ordinary GET to the redirect route (see
 * modules/links/redirect-route.ts), which already flows through the
 * existing ClickEventProducer -> BullMQ -> analytics pipeline untouched.
 * QR-originated traffic is distinguished using the UTM parameters this
 * module encodes into the QR image, which the existing analytics
 * pipeline already parses — see docs/architecture/qr-codes.md.
 *
 * Image generation is synchronous, in-process (no BullMQ queue): the
 * `qrcode` library renders a 512px PNG or SVG in low-single-digit
 * milliseconds, well within "acceptable without a background job" per
 * the Sprint 4 spec's own performance guidance. If generation ever
 * becomes expensive enough to reconsider (e.g. bulk/batch generation),
 * QrGeneratorService is already the single seam that would move behind
 * a queue.
 */
@Module({
  imports: [BillingModule, DomainsModule, WebhooksModule],
  controllers: [LinkQrCodesController, QrCodesController],
  providers: [QrCodesService, QrGeneratorService],
  exports: [QrCodesService],
})
export class QrCodesModule {}
