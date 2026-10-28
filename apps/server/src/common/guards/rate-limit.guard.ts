import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../../database/redis.module';
import Redis from 'ioredis';
import { AuthenticatedUser } from '../../auth/decorators/current-user.decorator';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  /** 窗口秒数 */
  windowSeconds: number;
  /** 窗口内最大请求数 */
  max: number;
  /** 按用户维度限流（true 时按 userId，否则按 IP） */
  byUser?: boolean;
  /** 身份认证等接口在 Redis 故障时拒绝请求，防止绕过限流。 */
  failClosed?: boolean;
}

/**
 * 接口限流守卫（P3 安全合规）
 * 用法：@UseGuards(RateLimitGuard) @RateLimit({ windowSeconds: 60, max: 30 })
 * Redis 不可用时默认放行；身份认证可使用 failClosed 拒绝请求。
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<
      RateLimitOptions | undefined
    >(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<{
      user?: AuthenticatedUser;
      ip?: string;
      socket?: { remoteAddress?: string };
    }>();
    const userId = request.user?.userId;
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    const keyBase =
      options.byUser !== false && userId ? `rl:u:${userId}` : `rl:ip:${ip}`;
    const key = `${keyBase}:${context.getHandler().name}`;

    try {
      const [count, ttl] = (await this.redis.eval(
        'local n = redis.call("INCR", KEYS[1]); if n == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end; return {n, redis.call("TTL", KEYS[1])}',
        1,
        key,
        options.windowSeconds,
      )) as [number, number];
      if (count > options.max) {
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
      if (err instanceof HttpException) throw err;
      if (options.failClosed) {
        this.logger.warn('身份认证限流存储不可用');
        throw new HttpException(
          '认证服务暂时不可用，请稍后再试',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      this.logger.warn(`限流检查跳过: ${(err as Error).message}`);
      return true;
    }
  }
}
