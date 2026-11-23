import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AccessTokenPayload } from '@shop/shared';

/**
 * `JwtAuthGuard` যে payload request-এ বসিয়েছে, সেটা handler-এ দেয়।
 * এটা DB-র ইউজার নয় — টোকেনের ভেতরের দাবি। তাজা ডেটা লাগলে DB থেকে পড়ো।
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AccessTokenPayload => {
    const request = context.switchToHttp().getRequest<Request & { user: AccessTokenPayload }>();
    return request.user;
  },
);
