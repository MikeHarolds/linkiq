import { z } from 'zod';

import { utmValueSchema } from './utm';

/** Mirrors the backend's CreateLinkSourceDto — reuses utmValueSchema
 * (the exact same length/control-char/dangerous-content rules the
 * backend's validateUtmValue enforces) rather than duplicating it. */
export const linkSourceSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  source: utmValueSchema,
  medium: utmValueSchema,
  campaign: z.union([utmValueSchema, z.literal('')]).optional(),
});

export type LinkSourceFormValues = z.infer<typeof linkSourceSchema>;

export const linkSourceUpdateSchema = linkSourceSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type LinkSourceUpdateFormValues = z.infer<typeof linkSourceUpdateSchema>;
