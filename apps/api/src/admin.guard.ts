import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
/** Закрывает административные маршруты статическим серверным токеном. */
export class AdminGuard implements CanActivate {
  /** Сравнивает обязательный X-Admin-Token с секретом окружения на каждый запрос. */
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_TOKEN;
    const actual = context.switchToHttp().getRequest<Request>().header('x-admin-token');
    // Отсутствующий production-секрет означает fail closed, а не открытый доступ.
    if (!expected || !actual || actual !== expected)
      throw new UnauthorizedException('Invalid admin token');
    return true;
  }
}
