import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';
import { RateLimitGuard } from './rate-limit.guard';

describe('接口限流', () => {
  function context(): ExecutionContext {
    return {
      getHandler: () => function ask() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: 'test-user' }, ip: '127.0.0.1' }),
      }),
    } as unknown as ExecutionContext;
  }

  it('计数与过期原子执行，超过配额返回 429', async () => {
    const redis = {
      eval: jest
        .fn()
        .mockResolvedValueOnce([1, 60])
        .mockResolvedValueOnce([2, 59]),
    };
    const reflector = {
      getAllAndOverride: () => ({ max: 1, windowSeconds: 60, byUser: true }),
    };
    const guard = new RateLimitGuard(
      reflector as unknown as Reflector,
      redis as unknown as Redis,
    );
    expect(await guard.canActivate(context())).toBe(true);
    try {
      await guard.canActivate(context());
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    }
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('EXPIRE'),
      1,
      'rl:u:test-user:ask',
      60,
    );
  });
});
