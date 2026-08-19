import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';

/**
 * 图谱管理守卫：仅允许管理员（role=admin）或身份为医生（identity=医生）的用户访问
 */
@Injectable()
export class GraphGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('未认证');
    const allowed = user.role === 'admin' || user.identity === '医生';
    if (!allowed) throw new ForbiddenException('仅管理员或医生可管理图谱');
    return true;
  }
}