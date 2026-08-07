import { registerAs } from '@nestjs/config';

/**
 * General application configuration, namespaced under "app".
 * Access via ConfigService.get('app.port'), etc.
 */
export default registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '4000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
}));
