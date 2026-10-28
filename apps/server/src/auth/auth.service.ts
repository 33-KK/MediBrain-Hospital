import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { User } from './entities/user.entity';
import { LoginDto, RegisterDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.userRepo.findOneBy({ username: dto.username });
    if (exists) throw new ConflictException('用户名已存在');

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      username: dto.username,
      password: hashed,
      displayName: dto.username,
      isActive: true,
      createdAt: new Date(),
    });
    await this.userRepo.save(user);

    return { token: this.signToken(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({
      where: { username: dto.username },
      select: {
        _id: true,
        username: true,
        password: true,
        isActive: true,
        displayName: true,
      },
    });
    if (!user) throw new UnauthorizedException('用户名或密码错误');

    const ok = await bcrypt.compare(dto.password, user.password);
    if (!ok) throw new UnauthorizedException('用户名或密码错误');
    if (!user.isActive) throw new UnauthorizedException('账号已被禁用');

    return {
      token: this.signToken(user),
      user: {
        userId: user._id.toString(),
        username: user.username,
        displayName: user.displayName,
      },
    };
  }

  private signToken(user: User): string {
    const payload = {
      sub: user._id.toString(),
      username: user.username,
    };
    return this.jwtService.sign(payload);
  }
}
