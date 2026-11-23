import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AccessTokenPayload } from '@shop/shared';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TokenService } from '../token.service';

/**
 * Global guard — `app.module.ts`-এ APP_GUARD হিসেবে বসে।
 * ডিফল্টে সব route বন্ধ; খুলতে হলে `@Public()` লিখতে হবে।
 * উল্টোটা (ডিফল্টে খোলা) বিপজ্জনক — একটা decorator ভুলে গেলেই route ফাঁস।
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

    const request = context.switchToHttp().getRequest<Request & { user?: AccessTokenPayload }>();
    const token = this.extractToken(request);

    if (!token) {
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
