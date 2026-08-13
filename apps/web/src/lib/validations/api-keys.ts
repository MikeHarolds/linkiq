import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(200, 'Name is too long'),
  expiresAt: z.string().optional(),
});

export type CreateApiKeyFormValues = z.infer<typeof createApiKeySchema>;
