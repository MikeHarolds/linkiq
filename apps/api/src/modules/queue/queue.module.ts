import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

/**
 * Configures the shared BullMQ connection used by all job queues.
 *
 * No queues are registered yet — this module only establishes the
 * BullMQ <-> Redis connection so feature modules (e.g. link-analytics
 * processing, webhook delivery) can register their own queues via
 * `BullModule.registerQueue({ name: '...' })` without repeating
 * connection config, in their respective feature milestones.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
