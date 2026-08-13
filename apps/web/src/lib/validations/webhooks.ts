import { z } from 'zod';

export const createWebhookEndpointSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(200, 'Name is too long'),
  url: z
    .string()
    .trim()
    .min(1, 'URL is required')
    .url('Enter a valid URL, e.g. https://example.com/webhooks'),
});

export type CreateWebhookEndpointFormValues = z.infer<
  typeof createWebhookEndpointSchema
>;

export const updateWebhookEndpointSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(200, 'Name is too long'),
  url: z
    .string()
    .trim()
    .min(1, 'URL is required')
    .url('Enter a valid URL, e.g. https://example.com/webhooks'),
});

export type UpdateWebhookEndpointFormValues = z.infer<
  typeof updateWebhookEndpointSchema
>;
