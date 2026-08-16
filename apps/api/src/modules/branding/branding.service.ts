import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type SiteBranding } from '@prisma/client';

import type { RequestContext } from '../../common/decorators/request-context.decorator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

import type { UpdateBrandingDto } from './dto/update-branding.dto';
import { MEDIA_STORAGE_PROVIDER, type MediaStorageProvider } from './storage/media-storage.interface';
import {
  MAX_FAVICON_BYTES,
  MAX_LOGO_BYTES,
  validateUploadedImage,
  type UploadedFileLike,
} from './upload-validation';

/** Fixed id for the single SiteBranding row — see the model's own doc
 * comment in schema.prisma for why a singleton is enforced here
 * (application logic) rather than at the schema level. Every read/
 * write in this service targets exactly this id. */
const SINGLETON_ID = '00000000-0000-0000-0000-000000000001';

const CACHE_TTL_MS = 60 * 1000;

/**
 * Platform-wide branding (Sprint 14): site name, logo, favicon. Backs
 * both the admin branding page (full read/write) and the public
 * site-config endpoint every unauthenticated surface (marketing site,
 * login, register) reads from — see PublicController.
 */
@Injectable()
export class BrandingService {
  private cache: { branding: SiteBranding; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(MEDIA_STORAGE_PROVIDER) private readonly storage: MediaStorageProvider,
  ) {}

  async get(): Promise<SiteBranding> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.branding;
    }
    const branding = await this.prisma.siteBranding.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID },
      update: {},
    });
    this.cache = { branding, expiresAt: now + CACHE_TTL_MS };
    return branding;
  }

  async updateSiteName(input: UpdateBrandingDto, adminUserId: string, ctx: RequestContext): Promise<SiteBranding> {
    const branding = await this.prisma.siteBranding.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...input },
      update: input,
    });
    this.cache = null;
    await this.audit.record({
      action: 'admin.branding_updated',
      entity: 'SiteBranding',
      entityId: SINGLETON_ID,
      userId: adminUserId,
      metadata: JSON.parse(JSON.stringify({ changes: input })) as Prisma.InputJsonValue,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return branding;
  }

  async uploadLogo(file: UploadedFileLike, adminUserId: string, ctx: RequestContext): Promise<SiteBranding> {
    return this.uploadImage(file, 'logo', MAX_LOGO_BYTES, adminUserId, ctx);
  }

  async uploadFavicon(file: UploadedFileLike, adminUserId: string, ctx: RequestContext): Promise<SiteBranding> {
    return this.uploadImage(file, 'favicon', MAX_FAVICON_BYTES, adminUserId, ctx);
  }

  async removeLogo(adminUserId: string, ctx: RequestContext): Promise<SiteBranding> {
    return this.removeImage('logo', adminUserId, ctx);
  }

  async removeFavicon(adminUserId: string, ctx: RequestContext): Promise<SiteBranding> {
    return this.removeImage('favicon', adminUserId, ctx);
  }

  private async uploadImage(
    file: UploadedFileLike,
    slot: 'logo' | 'favicon',
    maxBytes: number,
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<SiteBranding> {
    validateUploadedImage(file, maxBytes);

    const current = await this.get();
    const urlField = slot === 'logo' ? 'logoUrl' : 'faviconUrl';
    const previousUrl = current[urlField];

    const saved = await this.storage.save(file.buffer, file.originalname, file.mimetype);

    const branding = await this.prisma.siteBranding.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, [urlField]: saved.url },
      update: { [urlField]: saved.url },
    });
    this.cache = null;

    // Best-effort cleanup of the file being replaced — never blocks or
    // fails the upload itself (see LocalDiskStorageProvider.delete's
    // own docs on why this is always safe to attempt).
    if (previousUrl) {
      const previousKey = this.storageKeyFromUrl(previousUrl);
      if (previousKey) await this.storage.delete(previousKey);
    }

    await this.audit.record({
      action: slot === 'logo' ? 'admin.branding_logo_uploaded' : 'admin.branding_favicon_uploaded',
      entity: 'SiteBranding',
      entityId: SINGLETON_ID,
      userId: adminUserId,
      metadata: { originalFilename: file.originalname, sizeBytes: file.size },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return branding;
  }

  private async removeImage(
    slot: 'logo' | 'favicon',
    adminUserId: string,
    ctx: RequestContext,
  ): Promise<SiteBranding> {
    const current = await this.get();
    const urlField = slot === 'logo' ? 'logoUrl' : 'faviconUrl';
    const previousUrl = current[urlField];

    const branding = await this.prisma.siteBranding.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID },
      update: { [urlField]: null },
    });
    this.cache = null;

    if (previousUrl) {
      const previousKey = this.storageKeyFromUrl(previousUrl);
      if (previousKey) await this.storage.delete(previousKey);
    }

    await this.audit.record({
      action: slot === 'logo' ? 'admin.branding_logo_removed' : 'admin.branding_favicon_removed',
      entity: 'SiteBranding',
      entityId: SINGLETON_ID,
      userId: adminUserId,
      metadata: {},
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return branding;
  }

  /** SiteBranding only stores the public URL a saved file resolves to
   * (see schema.prisma's own docs on why there's no separate storage-
   * key column) — this recovers the storage key LocalDiskStorageProvider
   * needs to delete it, by stripping the known public-URL prefix back
   * off. Returns null for a URL that doesn't match the current
   * provider's shape (e.g. left over from a previous provider after a
   * storage-backend migration) rather than guessing. */
  private storageKeyFromUrl(url: string): string | null {
    const marker = '/uploads/';
    const index = url.indexOf(marker);
    if (index === -1) return null;
    return url.slice(index + marker.length);
  }
}
