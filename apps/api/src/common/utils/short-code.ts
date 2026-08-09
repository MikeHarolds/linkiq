import { randomInt } from 'crypto';

import { isReservedSlug } from '../constants/reserved-slugs';

const BASE62_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const AUTO_CODE_LENGTH = 7;
const CUSTOM_SLUG_MIN_LENGTH = 3;
const CUSTOM_SLUG_MAX_LENGTH = 50;
const CUSTOM_SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Generates a random, unpredictable short code (crypto-secure, not
 * Math.random) — 7 base62 characters gives ~2^41 possibilities, making
 * blind enumeration of other tenants' links impractical while staying
 * short enough to be pleasant in a URL. Uniqueness itself is enforced by
 * the database's unique constraint on `shortCode`; the caller (see
 * LinksService) retries on collision rather than this function trying to
 * guarantee uniqueness itself.
 */
export function generateShortCode(length = AUTO_CODE_LENGTH): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += BASE62_ALPHABET[randomInt(0, BASE62_ALPHABET.length)];
  }
  return code;
}

export interface SlugValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validates a user-supplied custom slug. Does NOT check the database for
 * uniqueness (that's a separate, necessarily-async concern handled by
 * LinksService against the DB's unique constraint — see that module for
 * why uniqueness can't be fully guaranteed by a synchronous check alone).
 */
export function validateCustomSlug(slug: string): SlugValidationResult {
  if (slug.length < CUSTOM_SLUG_MIN_LENGTH) {
    return {
      valid: false,
      reason: `Slug must be at least ${CUSTOM_SLUG_MIN_LENGTH} characters`,
    };
  }

  if (slug.length > CUSTOM_SLUG_MAX_LENGTH) {
    return {
      valid: false,
      reason: `Slug must be at most ${CUSTOM_SLUG_MAX_LENGTH} characters`,
    };
  }

  if (!CUSTOM_SLUG_PATTERN.test(slug)) {
    return {
      valid: false,
      reason:
        'Slug may only contain letters, numbers, hyphens, and underscores',
    };
  }

  if (isReservedSlug(slug)) {
    return { valid: false, reason: 'This slug is reserved and cannot be used' };
  }

  return { valid: true };
}
