import { z } from 'zod';

/**
 * Mirrors the backend's password rule (apps/api DTOs): 8+ characters, at
 * least one uppercase letter, one lowercase letter, and one number. Kept
 * in sync manually since the two run in different runtimes — the backend
 * re-validates independently regardless of what the client sends.
 */
const passwordSchema = z
  .string()
  .min(8, 'Must be at least 8 characters')
  .max(128)
  .regex(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message:
      'Must include an uppercase letter, a lowercase letter, and a number',
  });

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(1, 'Required').max(100),
    lastName: z.string().trim().min(1, 'Required').max(100),
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    password: passwordSchema,
    passwordConfirmation: z.string(),
    termsAccepted: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the Terms of Service' }),
    }),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
  });

export type RegisterFormValues = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Required'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
});

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    passwordConfirmation: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
  });

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: passwordSchema,
    newPasswordConfirmation: z.string(),
  })
  .refine((data) => data.newPassword === data.newPasswordConfirmation, {
    message: 'Passwords do not match',
    path: ['newPasswordConfirmation'],
  });

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1, 'Required').max(100),
  lastName: z.string().trim().min(1, 'Required').max(100),
});

export type UpdateProfileFormValues = z.infer<typeof updateProfileSchema>;
