import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../../database/redis.module';
import Redis from 'ioredis';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  /** 窗口秒数 */
  windowSeconds: number;
  /** 窗口内最大请求数 */
  max: number;
  /** 按用户维度限流（true 时按 userId，否则按 IP） */
  byUser?: boolean;
}

/**
 * 接口限流守卫（P3 安全合规）
 * 用法：@UseGuards(RateLimitGuard) @RateLimit({ windowSeconds: 60, max: 30 })
 * Redis 不可用时放行（降级不阻断业务）。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.userId;
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    const keyBase = options.byUser !== false && userId ? `rl:u:${userId}` : `rl:ip:${ip}`;
    const key = `${keyBase}:${context.getHandler().name}`;

    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, options.windowSeconds);
      }
      if (count > options.max) {
        const ttl = await this.redis.ttl(key);
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: `请求过于频繁，请 ${ttl > 0 ? `${ttl} 秒后` : '稍后'}再试`,
            error: 'Too Many Requests',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    } catch (err) {
      // Redis 异常时放行，避免限流本身成为故障点
      if (err instanceof HttpException) throw err;
      this.logger.warn(`限流检查跳过: ${(err as Error).message}`);
      return true;
    }
  }
}