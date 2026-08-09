import { Global, Module } from '@nestjs/common';

import { AuditService } from './audit.service';

/**
 * Global so any module can inject AuditService without importing
 * AuditModule explicitly — consistent with PrismaModule/RedisModule.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
