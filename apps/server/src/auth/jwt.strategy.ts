import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { User } from './entities/user.entity';

export interface JwtPayload {
  sub: string;
  username: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('app.jwtSecret'),
    });
  }

  async validate(payload: JwtPayload) {
    if (
      typeof payload.sub !== 'string' ||
      !/^[a-f\d]{24}$/i.test(payload.sub)
    ) {
      throw new UnauthorizedException('登录凭证无效');
    }
    const user = await this.userRepo.findOneBy({
      _id: new ObjectId(payload.sub),
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('账号不存在或已被禁用');
    }
    return {
      userId: user._id.toString(),
      username: user.username,
    };
  }
}
