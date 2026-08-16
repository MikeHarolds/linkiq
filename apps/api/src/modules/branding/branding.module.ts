import { Module } from '@nestjs/common';

import { BrandingService } from './branding.service';
import { LocalDiskStorageProvider } from './storage/local-disk-storage.provider';
import { MEDIA_STORAGE_PROVIDER } from './storage/media-storage.interface';

/**
 * Site Branding (Sprint 14). Owns BrandingService + the storage
 * provider binding only — controllers live in AdminModule
 * (AdminBrandingController, full read/write, SuperAdminGuard) and
 * PublicModule (PublicController, read-only site-config), the same
 * "one service, multiple controllers" shape LandingPageModule uses.
 *
 * MEDIA_STORAGE_PROVIDER is a swappable DI token (see
 * storage/media-storage.interface.ts) — LocalDiskStorageProvider is
 * the only implementation this sprint ships; a future S3-backed
 * provider is a new class + one line here, nothing else changes.
 */
@Module({
  providers: [
    BrandingService,
    { provide: MEDIA_STORAGE_PROVIDER, useClass: LocalDiskStorageProvider },
  ],
  exports: [BrandingService],
})
export class BrandingModule {}
