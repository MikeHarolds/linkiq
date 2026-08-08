import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Global, Nest-managed ioredis client. Used directly for caching /
 * ad-hoc key-value operations; BullMQ (see modules/queue) manages its
 * own dedicated connections internally per BullMQ's requirements.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return new Redis({
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
