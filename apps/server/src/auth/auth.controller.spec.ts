import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { REDIS_CLIENT } from '../database/redis.module';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { httpSettings } from '../config/http-settings';

describe('公网身份认证限流', () => {
  let app: NestExpressApplication;
  const counts = new Map<string, number>();
  const redis = { eval: jest.fn() };
  const authService = {
    login: jest.fn().mockResolvedValue({ access_token: 'test-token' }),
    register: jest.fn().mockResolvedValue({ id: 'test-user' }),
  };

  beforeEach(async () => {
    counts.clear();
    jest.clearAllMocks();
    redis.eval.mockReset().mockImplementation((_script, _keys, key: string) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return Promise.resolve([count, 60]);
    });
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: REDIS_CLIENT, useValue: redis },
        RateLimitGuard,
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    const settings = httpSettings({ NODE_ENV: 'production' });
    app.set('trust proxy', false);
    app.enableCors({ origin: settings.corsOrigins, credentials: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([{ identity: '患者' }, { role: 'admin' }])(
    '注册接口不再接受身份/角色字段：%j',
    async (legacy) => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ username: 'test', password: 'test-password', ...legacy })
        .expect(400);
      expect(authService.register).not.toHaveBeenCalled();
    },
  );

  it('伪造转发 IP 不能绕过登录配额，登录和注册配额独立', async () => {
    for (let i = 0; i < 20; i++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', `203.0.113.${i + 1}`)
        .send({ username: 'test', password: 'test-password' })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', '198.51.100.1')
      .send({ username: 'test', password: 'test-password' })
      .expect(429);
    expect(authService.login).toHaveBeenCalledTimes(20);
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ username: 'another', password: 'test-password' })
      .expect(201);
  });

  it('注册超过每小时配额后不执行创建用户', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ username: `user-${i}`, password: 'test-password' })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ username: 'last-user', password: 'test-password' })
      .expect(429);
    expect(authService.register).toHaveBeenCalledTimes(10);
  });

  it('认证限流存储不可用时返回 503，不继续验证密码或创建用户', async () => {
    redis.eval.mockRejectedValue(new Error('offline'));
    for (const endpoint of ['login', 'register']) {
      await request(app.getHttpServer())
        .post(`/auth/${endpoint}`)
        .send({ username: 'test', password: 'test-password' })
        .expect(503);
    }
    expect(authService.login).not.toHaveBeenCalled();
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('生产默认不向任意外站授予跨域权限', async () => {
    const result = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'https://untrusted.example')
      .send({ username: 'test', password: 'test-password' })
      .expect(201);
    expect(result.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('只信任指定代理，使用代理链中最近的非可信 IP 计数', async () => {
    const settings = httpSettings({ TRUST_PROXY_CIDRS: '127.0.0.1/8,::1/128' });
    app.set('trust proxy', settings.trustProxy);
    for (const spoofed of ['203.0.113.1', '203.0.113.2']) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .set('X-Forwarded-For', `${spoofed}, 198.51.100.10`)
        .send({ username: 'test', password: 'test-password' })
        .expect(201);
    }
    expect(counts.get('rl:ip:198.51.100.10:login')).toBe(2);
  });
});
