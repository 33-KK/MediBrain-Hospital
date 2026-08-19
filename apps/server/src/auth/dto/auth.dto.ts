import {
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { UserIdentity } from '../entities/user.entity';

export class RegisterDto {
  @IsString()
  @MinLength(3)
  username: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsEnum(UserIdentity)
  identity?: UserIdentity;
}

export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  password: string;
}