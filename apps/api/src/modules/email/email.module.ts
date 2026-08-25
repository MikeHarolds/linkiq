import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { BrandingModule } from '../branding/branding.module';

import { EmailConfigService } from './email-config.service';
import { EmailService } from './email.service';
import { EmailProviderFactory } from './providers/email-provider.factory';
import { EmailDeliveryProcessor } from './queue/email-delivery.processor';
import { EmailDeliveryProducer } from './queue/email-delivery.producer';
import { EMAIL_QUEUE } from './queue/email-delivery.types';
import { EmailSecretCipherService } from './security/email-secret-cipher.service';
import { EmailRendererService } from './templates/email-renderer.service';

/**
 * Transactional email infrastructure (Sprint 20) — provider
 * abstraction, encrypted config, queue/worker, templates. Mirrors
 * WebhooksModule's shape: BullModule.registerQueue for its own queue,
 * producer + processor both listed in providers, EmailService as the
 * single exported entry point other modules call (the same role
 * WebhookEventsService plays for webhooks). EmailConfigService/
 * EmailSecretCipherService are also exported so AdminModule's email
 * settings controller can read/write configuration directly without a
 * second copy of this logic.
 */
@Module({
  imports: [
    AuditModule,
    BrandingModule,
    BullModule.registerQueue({ name: EMAIL_QUEUE }),
  ],
  providers: [
    EmailService,
    EmailConfigService,
    EmailSecretCipherService,
    EmailProviderFactory,
    EmailRendererService,
    EmailDeliveryProducer,
    EmailDeliveryProcessor,
  ],
  exports: [
    EmailService,
    EmailConfigService,
    EmailSecretCipherService,
    EmailProviderFactory,
  ],
})
export class EmailModule {}
