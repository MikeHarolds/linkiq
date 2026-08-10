import { z } from 'zod';

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Mirrors the backend's QR validation (qr-validation.ts): size/margin
 * bounds and hex color format. The identical-color check (the one thing
 * no single-field rule can catch) is applied via the schema's top-level
 * `.refine`, matching the backend's effective-config validation. */
export const qrConfigSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(200, 'Name is too long'),
    format: z.enum(['PNG', 'SVG']).default('PNG'),
    size: z.coerce
      .number()
      .int()
      .min(128, 'Minimum size is 128px')
      .max(1024, 'Maximum size is 1024px')
      .default(512),
    foregroundColor: z
      .string()
      .regex(HEX_COLOR_REGEX, 'Enter a valid hex color, e.g. #000000')
      .default('#000000'),
    backgroundColor: z
      .string()
      .regex(HEX_COLOR_REGEX, 'Enter a valid hex color, e.g. #FFFFFF')
      .default('#FFFFFF'),
    errorCorrectionLevel: z.enum(['L', 'M', 'Q', 'H']).default('M'),
    margin: z.coerce
      .number()
      .int()
      .min(0, 'Minimum margin is 0')
      .max(20, 'Maximum margin is 20')
      .default(4),
  })
  .refine(
    (data) =>
      data.foregroundColor.toLowerCase() !== data.backgroundColor.toLowerCase(),
    {
      message:
        'Foreground and background colors must be different — identical colors produce an unreadable QR code',
      path: ['backgroundColor'],
    },
  );

export type QrConfigFormValues = z.infer<typeof qrConfigSchema>;
