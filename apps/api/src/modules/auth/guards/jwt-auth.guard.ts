import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AccessTokenPayload } from '@shop/shared';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TokenService } from '../token.service';

/**
 * Global guard — `app.module.ts`-এ APP_GUARD হিসেবে বসে।
 * ডিফল্টে সব route বন্ধ; খুলতে হলে `@Public()` লিখতে হবে।
 * উল্টোটা (ডিফল্টে খোলা) বিপজ্জনক — একটা decorator ভুলে গেলেই route ফাঁস।
 *
 * তিনটা অবস্থা:
 * - কিছু না লেখা → টোকেন বাধ্যতামূলক
 * - `@Public()` → টোকেন দেখা হয় না
 * - `@OptionalAuth()` → টোকেন থাকলে যাচাই হয়, না থাকলেও চলে
 *   (গেস্ট চেকআউট — `request.user` তখন `undefined`)
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const isOptional = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request & { user?: AccessTokenPayload }>();
    const token = this.extractToken(request);

    if (!token) {
      if (isOptional === true) {
        /**
         * গেস্ট — `request.user` বসানো হয় না।
         *
         * ভুয়া user বসিয়ে দিলে নিচের `RolesGuard` আর handler-এর
         * ownership যাচাই দুটোই বিভ্রান্ত হতো। অনুপস্থিতিই সবচেয়ে
         * নিরাপদ সংকেত: `RolesGuard` user না পেলে বন্ধ করে দেয়।
         */
        return true;
      }

      throw new UnauthorizedException('Authentication required');
    }

    try {
      request.user = await this.tokenService.verifyAccessToken(token);
      return true;
    } catch {
      // কেন ব্যর্থ হলো (মেয়াদ শেষ / signature ভুল) সেটা বলা হয় না — তথ্য ফাঁস হয়
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;

    if (!header) {
      return null;
    }

    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }
}
