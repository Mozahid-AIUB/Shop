import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AccessTokenPayload, Role } from '@shop/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * `@Roles(...)` দেখে সিদ্ধান্ত নেয়। `JwtAuthGuard`-এর **পরে** চলে,
 * তাই এখানে `request.user` থাকার কথা।
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AccessTokenPayload }>();
    const user = request.user;

    // user না থাকা মানে guard-এর ক্রম ভুল — চুপ করে ঢুকতে দেওয়ার চেয়ে আটকানো ভালো
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
