export interface SavedFile {
  /** Publicly reachable URL for this file — what gets stored on
   * SiteBranding.logoUrl/faviconUrl and rendered directly by the
   * frontend, e.g. as an <img src>. */
  url: string;
  /** Provider-internal identifier needed to delete this file later
   * (a filesystem path for LocalDiskStorageProvider; an object key for
   * a future S3-shaped provider). Never exposed to the frontend. */
  storageKey: string;
}

/**
 * Abstraction over "store these bytes somewhere durable, get a public
 * URL back." Deliberately not tied to local disk — see
 * local-disk-storage.provider.ts (the only implementation this sprint
 * ships). Swap in a different implementation (S3, GCS, Cloudinary, ...)
 * by providing a different class under this same token in
 * branding.module.ts; nothing else in the codebase needs to change —
 * the same swap pattern GeoIpProvider and BillingProvider already use.
 */
export interface MediaStorageProvider {
  save(buffer: Buffer, originalFilename: string, mimeType: string): Promise<SavedFile>;
  /** Never throws if the file is already gone — deleting something
   * that doesn't exist is a successful no-op, not an error. */
  delete(storageKey: string): Promise<void>;
}

export const MEDIA_STORAGE_PROVIDER = 'MEDIA_STORAGE_PROVIDER';
