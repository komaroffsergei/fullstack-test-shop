import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.ADMIN_TOKEN;
    const actual = context.switchToHttp().getRequest<Request>().header('x-admin-token');
    if (!expected || !actual || actual !== expected)
      throw new UnauthorizedException('Invalid admin token');
    return true;
  }
}
