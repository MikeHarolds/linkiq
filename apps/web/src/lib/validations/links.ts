import { z } from 'zod';

import { utmDefaultsSchema } from './utm';

/**
 * Mirrors the backend's URL validation (apps/api's url-validator.ts):
 * absolute http/https URLs only. The backend re-validates independently
 * regardless of what the client sends — this is a UX convenience, not
 * the security boundary.
 */
const destinationUrlSchema = z
  .string()
  .trim()
  .min(1, 'Destination URL is required')
  .max(2048, 'URL is too long')
  .refine(
    (value) => {
      try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Enter a valid http:// or https:// URL' },
  );

/** Mirrors the backend's slug rules (short-code.ts): 3-50 chars, letters/numbers/hyphens/underscores. */
const slugSchema = z
  .string()
  .trim()
  .min(3, 'Slug must be at least 3 characters')
  .max(50, 'Slug must be at most 50 characters')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Only letters, numbers, hyphens, and underscores are allowed',
  );

export const createLinkSchema = z
  .object({
    destinationUrl: destinationUrlSchema,
    slug: z.union([slugSchema, z.literal('')]).optional(),
    title: z.string().trim().max(200).optional().or(z.literal('')),
    description: z.string().trim().max(1000).optional().or(z.literal('')),
    expiresAt: z.string().optional().or(z.literal('')),
    campaignId: z.string().optional().or(z.literal('')),
  })
  .merge(utmDefaultsSchema);

export type CreateLinkFormValues = z.infer<typeof createLinkSchema>;

export const updateLinkSchema = z.object({
  destinationUrl: destinationUrlSchema,
  title: z.string().trim().max(200).optional().or(z.literal('')),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  expiresAt: z.string().optional().or(z.literal('')),
});

export type UpdateLinkFormValues = z.infer<typeof updateLinkSchema>;
