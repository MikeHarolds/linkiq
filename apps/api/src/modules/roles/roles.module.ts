import { Module } from '@nestjs/common';

import { PlatformPermissionsGuard } from './guards/platform-permissions.guard';
import { PlatformRolesService } from './platform-roles.service';
import { RoleResolutionService } from './role-resolution.service';

/**
 * Sprint 15 — platform roles & permissions. Deliberately depends only on
 * PrismaService/AuditService (both @Global(), no explicit import needed)
 * — never on BillingModule/SubscriptionsService, even though
 * RoleResolutionService reads subscription data, to avoid the circular
 * dependency BillingModule -> RolesModule -> BillingModule (BillingModule
 * imports this module so SubscriptionsService/PaystackWebhookProcessor
 * can call RoleResolutionService.syncStoredRole()). See
 * RoleResolutionService's own docs.
 */
@Module({
  providers: [RoleResolutionService, PlatformRolesService, PlatformPermissionsGuard],
  exports: [RoleResolutionService, PlatformRolesService, PlatformPermissionsGuard],
})
export class RolesModule {}
