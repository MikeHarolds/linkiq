import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresInDays: parseInt(
      process.env.JWT_REFRESH_EXPIRES_IN_DAYS ?? '7',
      10,
    ),
  },
  cookie: {
    name: process.env.REFRESH_COOKIE_NAME ?? 'linkiq_refresh_token',
    secure: process.env.NODE_ENV === 'production',
    domain: process.env.COOKIE_DOMAIN || undefined,
  },
  passwordReset: {
    tokenExpiresInMinutes: parseInt(
      process.env.PASSWORD_RESET_EXPIRES_IN_MINUTES ?? '30',
      10,
    ),
  },
  emailVerification: {
    tokenExpiresInHours: parseInt(
      process.env.EMAIL_VERIFICATION_EXPIRES_IN_HOURS ?? '24',
      10,
    ),
  },
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10),
}));
