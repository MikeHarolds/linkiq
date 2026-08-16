import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { MediaStorageProvider, SavedFile } from './media-storage.interface';

/**
 * Default MediaStorageProvider: writes to a local directory served
 * statically by this same process (see main.ts's ServeStaticModule-
 * equivalent setup). No external dependency, no API keys — appropriate
 * for a single-instance deployment; a multi-instance/horizontally-
 * scaled deployment would swap this for an S3-backed implementation
 * behind the same MediaStorageProvider interface (see its own docs).
 *
 * Filenames are always server-generated (a random UUID + the original
 * extension) — the caller-supplied filename is never used directly on
 * disk, which is what rules out path traversal via a crafted filename
 * like "../../etc/passwd.png".
 */
@Injectable()
export class LocalDiskStorageProvider implements MediaStorageProvider {
  private readonly logger = new Logger(LocalDiskStorageProvider.name);
  private readonly uploadDir: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.uploadDir = this.config.get<string>('branding.uploadDir')!;
    this.publicBaseUrl = this.config.get<string>('branding.publicUrl')!;
  }

  async save(buffer: Buffer, originalFilename: string, _mimeType: string): Promise<SavedFile> {
    const ext = extname(originalFilename).toLowerCase();
    const filename = `${randomUUID()}${ext}`;
    const brandingDir = join(this.uploadDir, 'branding');
    await mkdir(brandingDir, { recursive: true });
    const fullPath = join(brandingDir, filename);
    await writeFile(fullPath, buffer);

    const storageKey = join('branding', filename);
    return {
      url: `${this.publicBaseUrl}/uploads/branding/${filename}`,
      storageKey,
    };
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await unlink(join(this.uploadDir, storageKey));
    } catch (error) {
      // ENOENT (already gone) is a successful no-op; anything else is
      // logged but still never thrown — a failed cleanup must not block
      // the admin action that triggered it (e.g. uploading a
      // replacement logo should succeed even if deleting the old file
      // fails for some unrelated filesystem reason).
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn(`Failed to delete stored file "${storageKey}": ${String(error)}`);
      }
    }
  }
}
