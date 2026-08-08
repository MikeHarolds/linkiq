import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

/**
 * Structured, production-grade logging via Pino.
 *   - JSON logs in production (ingestible by any log aggregator)
 *   - Pretty, colorized logs in development
 *   - Automatic HTTP request/response logging with correlation
 *   - Redacts sensitive headers by default
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  colorize: true,
                  translateTime: 'SYS:HH:MM:ss',
                  ignore: 'pid,hostname',
                },
              }
            : undefined,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
        customProps: () => ({ context: 'HTTP' }),
        autoLogging: {
          ignore: (req) => req.url === '/api/v1/health',
        },
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
