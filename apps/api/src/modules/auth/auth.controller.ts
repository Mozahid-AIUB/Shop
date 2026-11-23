import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UsePipes,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import {
  loginSchema,
  registerSchema,
  type AccessTokenPayload,
  type AuthResponse,
  type AuthUser,
  type LoginInput,
  type RegisterInput,
} from '@shop/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService, type AuthResult } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import type { IssuedRefreshToken } from './token.service';

/** refresh cookie-র নাম — web-এর middleware এই নামটাই খোঁজে। */
export const REFRESH_COOKIE = 'refreshToken';

/**
 * cookie path `/auth` — অন্য কোনো endpoint-এ refresh টোকেন পাঠানোর দরকার নেই,
 * তাই ব্রাউজারও পাঠাবে না। CSRF-এর পরিসর ছোট হয়।
 */
const COOKIE_PATH = '/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @UsePipes(new ZodValidationPipe(registerSchema))
  async register(
    @Body() body: RegisterInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.register(body, this.context(request));
    return this.send(response, result);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.login(body, this.context(request));
    return this.send(response, result);
  }

  /**
   * `@Public()` কারণ access token ততক্ষণে মেয়াদোত্তীর্ণ —
   * প্রমাণ আসে cookie-র refresh টোকেন থেকে, Authorization header থেকে নয়।
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const token = this.readRefreshCookie(request);

    if (!token) {
      throw new UnauthorizedException('No refresh token');
    }

    try {
      const result = await this.auth.refresh(token, this.context(request));
      return this.send(response, result);
    } catch (error) {
      // টোকেন কাজে লাগেনি — মরা cookie রেখে দেওয়ার মানে নেই
      this.clearRefreshCookie(response);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: true }> {
    await this.auth.logout(this.readRefreshCookie(request));
    this.clearRefreshCookie(response);

    return { success: true };
  }

  @Get('me')
  async me(@CurrentUser() user: AccessTokenPayload): Promise<AuthUser> {
    // টোকেনের role নয়, DB-র তাজা তথ্য — মাঝপথে role বদলালে বা
    // অ্যাকাউন্ট বন্ধ হলে সেটা এখানে ধরা পড়বে
    return this.auth.findById(user.sub);
  }

  /**
   * RBAC guard সত্যিই কাজ করছে কিনা তা যাচাই করার endpoint।
   * Phase 09-এ আসল admin route এলে এটা সরিয়ে দেওয়া হবে।
   */
  @Roles('SUPER_ADMIN', 'ORDER_MANAGER', 'DESIGNER', 'ACCOUNTANT')
  @Get('admin-check')
  adminCheck(@CurrentUser() user: AccessTokenPayload): { ok: true; role: string } {
    return { ok: true, role: user.role };
  }

  private send(response: Response, result: AuthResult): AuthResponse {
    this.setRefreshCookie(response, result.refresh);
    return result.response;
  }

  private context(request: Request): { userAgent?: string; ip?: string } {
    return {
      userAgent: request.headers['user-agent'],
      ip: request.ip,
    };
  }

  private readRefreshCookie(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, string> | undefined;
    return cookies?.[REFRESH_COOKIE];
  }

  private setRefreshCookie(response: Response, refresh: IssuedRefreshToken): void {
    response.cookie(REFRESH_COOKIE, refresh.token, {
      ...this.cookieOptions(),
      expires: refresh.expiresAt,
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  private cookieOptions(): CookieOptions {
    const isProduction = this.config.get<string>('NODE_ENV') === 'production';

    return {
      // JS পড়তে পারবে না — XSS হলেও টোকেন চুরি যাবে না
      httpOnly: true,
      // dev-এ http://localhost চলে, তাই secure শুধু প্রোডাকশনে
      secure: isProduction,
      // lax: সাধারণ navigation-এ যায়, cross-site POST-এ যায় না
      sameSite: 'lax',
      path: COOKIE_PATH,
    };
  }
}
