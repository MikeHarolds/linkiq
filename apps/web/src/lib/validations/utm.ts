import { z } from 'zod';

// eslint-disable-next-line no-control-regex
const HEX_LIKE_CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const DANGEROUS_PATTERN = /<script|javascript:|data:text\/html/i;

/** Mirrors the backend's validateUtmValue (campaigns/utils/utm.ts):
 * permissive on free text, rejects control characters and obviously
 * dangerous content, capped at 255 characters. */
export const utmValueSchema = z
  .string()
  .trim()
  .max(255, 'Must be at most 255 characters')
  .refine((v) => !HEX_LIKE_CONTROL_CHARS.test(v), 'Contains invalid characters')
  .refine((v) => !DANGEROUS_PATTERN.test(v), 'Contains disallowed content');

export const utmDefaultsSchema = z.object({
  utmSource: z.union([utmValueSchema, z.literal('')]).optional(),
  utmMedium: z.union([utmValueSchema, z.literal('')]).optional(),
  utmCampaign: z.union([utmValueSchema, z.literal('')]).optional(),
  utmTerm: z.union([utmValueSchema, z.literal('')]).optional(),
  utmContent: z.union([utmValueSchema, z.literal('')]).optional(),
});

export type UtmDefaultsFormValues = z.infer<typeof utmDefaultsSchema>;

/**
 * Client-side mirror of the backend's applyUtmParams (campaigns/utils/utm.ts)
 * — used purely for the live "preview the final destination URL" UI
 * (link creation, campaign UTM defaults). The backend re-applies UTM
 * params independently at redirect time; this never affects what's
 * actually stored or redirected to, only what the user sees while
 * configuring a link.
 */
export function previewUtmUrl(
  baseUrl: string,
  utm: {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmTerm?: string;
    utmContent?: string;
  },
): string | null {
  try {
    const url = new URL(baseUrl);
    const map: Record<string, string | undefined> = {
      utm_source: utm.utmSource,
      utm_medium: utm.utmMedium,
      utm_campaign: utm.utmCampaign,
      utm_term: utm.utmTerm,
      utm_content: utm.utmContent,
    };
    for (const [param, value] of Object.entries(map)) {
      if (value) url.searchParams.set(param, value);
    }
    return url.toString();
  } catch {
    return null;
  }
}
