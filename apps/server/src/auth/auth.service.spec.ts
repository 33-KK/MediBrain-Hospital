import { ObjectId } from 'mongodb';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { User } from './entities/user.entity';

describe('统一登录账号及旧账号兼容', () => {
  const id = new ObjectId();
  const sign = jest.fn(() => 'token');
  const repo = {
    findOneBy: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn((value: Partial<User>) => ({ ...value, _id: id })),
    save: jest.fn((value: User) => Promise.resolve(value)),
  };
  const service = new AuthService(
    repo as unknown as Repository<User>,
    { sign } as unknown as JwtService,
  );
  beforeEach(() => jest.clearAllMocks());

  it('注册和签发凭证不再保存身份或角色', async () => {
    repo.findOneBy.mockResolvedValueOnce(null);
    await service.register({ username: 'new-user', password: 'test-password' });
    const created = repo.create.mock.calls[0]?.[0];
    expect(Object.keys(created ?? {}).sort()).toEqual([
      'createdAt',
      'displayName',
      'isActive',
      'password',
      'username',
    ]);
    expect(created?.username).toBe('new-user');
    expect(created?.displayName).toBe('new-user');
    expect(created?.isActive).toBe(true);
    expect(typeof created?.password).toBe('string');
    expect(created?.createdAt).toBeInstanceOf(Date);
    expect(sign).toHaveBeenCalledWith({
      sub: id.toString(),
      username: 'new-user',
    });
  });

  it('旧管理员/医生账号仍能用原密码登录，返回值不携带旧权限字段', async () => {
    repo.findOne.mockResolvedValueOnce({
      _id: id,
      username: 'legacy-user',
      password: await bcrypt.hash('original-password', 4),
      displayName: '旧账号',
      isActive: true,
      role: 'admin',
      identity: '医生',
    });
    const result = await service.login({
      username: 'legacy-user',
      password: 'original-password',
    });
    expect(result.user).toEqual({
      userId: id.toString(),
      username: 'legacy-user',
      displayName: '旧账号',
    });
    expect(sign).toHaveBeenCalledWith({
      sub: id.toString(),
      username: 'legacy-user',
    });
  });

  it('旧 token 中的角色字段被忽略，仍按数据库中的当前账号验证登录', async () => {
    const strategy = new JwtStrategy(
      new ConfigService({ app: { jwtSecret: 'test-secret' } }),
      repo as unknown as Repository<User>,
    );
    repo.findOneBy.mockResolvedValueOnce({
      _id: id,
      username: 'legacy-user',
      isActive: true,
      role: 'admin',
      identity: '患者家属',
    });
    const legacyPayload = {
      sub: id.toString(),
      username: 'legacy-user',
      role: 'admin',
      identity: '医生',
    };
    expect(await strategy.validate(legacyPayload)).toEqual({
      userId: id.toString(),
      username: 'legacy-user',
    });
    repo.findOneBy.mockResolvedValueOnce({ _id: id, isActive: false });
    await expect(strategy.validate(legacyPayload)).rejects.toThrow('已被禁用');
  });
});
