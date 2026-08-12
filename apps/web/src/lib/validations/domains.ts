import { z } from 'zod';

export const addDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .min(1, 'Domain is required')
    .max(253, 'Domain is too long')
    .regex(
      /^[a-zA-Z0-9.-]+$/,
      'Domain may only contain letters, numbers, dots, and hyphens',
    ),
});

export type AddDomainFormValues = z.infer<typeof addDomainSchema>;
