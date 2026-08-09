import { randomBytes } from 'crypto';

/** Lowercase, hyphenated, alphanumeric-only slug from arbitrary text. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Appends a short random suffix to virtually guarantee slug uniqueness. */
export function uniqueSlug(base: string): string {
  const suffix = randomBytes(3).toString('hex');
  const slugBase = slugify(base) || 'workspace';
  return `${slugBase}-${suffix}`;
}
