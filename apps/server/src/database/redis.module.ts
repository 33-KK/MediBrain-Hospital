import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        const client = new Redis({
          host: config.get<string>('database.redisHost') ?? 'localhost',
          port: config.get<number>('database.redisPort') ?? 6379,
          password: config.get<string>('database.redisPassword') || undefined,
          lazyConnect: false,
          maxRetriesPerRequest: 2,
          retryStrategy: (times) => Math.min(times * 200, 3000),
        });
        client.on('error', (err) => {
          // 避免未捕获异常导致进程崩溃；连接失败时自动重试
          console.error(`[Redis] 连接异常: ${err.message}`);
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
