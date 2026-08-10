import { z } from 'zod';

import { utmDefaultsSchema } from './utm';

export const campaignFormSchema = utmDefaultsSchema
  .extend({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(200, 'Name is too long'),
    description: z.string().trim().max(1000).optional().or(z.literal('')),
    startDate: z.string().optional().or(z.literal('')),
    endDate: z.string().optional().or(z.literal('')),
  })
  .refine(
    (data) =>
      !data.startDate ||
      !data.endDate ||
      new Date(data.endDate) >= new Date(data.startDate),
    {
      message: 'End date cannot be earlier than start date',
      path: ['endDate'],
    },
  );

export type CampaignFormValues = z.infer<typeof campaignFormSchema>;
