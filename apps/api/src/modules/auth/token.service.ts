import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenPayload } from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';

export interface IssuedRefreshToken {
  /** কাঁচা টোকেন — শুধু cookie-তে যায়, DB-তে নয়। */
  token: string;
  expiresAt: Date;
  familyId: string;
}

export interface RefreshContext {
  userAgent?: string;
  ip?: string;
}

/**
 * দুই ধরনের টোকেন, দুই কারণে:
 *
 * - **Access** — JWT, স্বল্পায়ু (15m)। প্রতি request-এ DB hit বাঁচায়।
 *   revoke করা যায় না, তাই আয়ু ছোট রাখা হয়।
 * - **Refresh** — random opaque string, DB-তে sha256 hash হয়ে থাকে।
 *   JWT নয় কারণ সেশন বাতিল করা দরকার হয়; DB row মুছলেই শেষ।
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  private readonly accessTtl: string;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.accessTtl = this.config.get<string>('JWT_ACCESS_TTL', '15m');
    this.refreshTtlDays = this.parseDays(this.config.get<string>('JWT_REFRESH_TTL', '7d'));
  }

  async signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.requireSecret('JWT_ACCESS_SECRET'),
      // সেকেন্ডে দিই — jsonwebtoken-এর টাইপ `"15m"` ধরনের literal চায়,
      // কিন্তু TTL .env থেকে আসে বলে সেটা সাধারণ string
      expiresIn: this.accessTokenLifetimeSeconds(),
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.requireSecret('JWT_ACCESS_SECRET'),
    });
  }

  /** access token কত সেকেন্ড পরে মরবে — ক্লায়েন্ট আগেভাগে refresh করতে পারে। */
  accessTokenLifetimeSeconds(): number {
    return this.parseSeconds(this.accessTtl);
  }

  /**
   * নতুন লগইন হলে `familyId` ছাড়া ডাকো — নতুন family জন্মাবে।
   * rotate করার সময় পুরোনো family-টা পাস করতে হবে।
   */
  async issueRefreshToken(
    userId: string,
    context: RefreshContext = {},
    familyId: string = randomUUID(),
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: this.hash(token),
        userId,
        familyId,
        expiresAt,
        userAgent: context.userAgent?.slice(0, 500) ?? null,
        ip: context.ip ?? null,
      },
    });

    return { token, expiresAt, familyId };
  }

  /**
   * Rotation: পুরোনোটা মুছে নতুন দেয়।
   *
   * টোকেন খুঁজে না পেলে দুটো সম্ভাবনা — কখনো ছিলই না, অথবা আগে rotate হয়ে গেছে
   * আর কেউ পুরোনোটা আবার পাঠাচ্ছে। দ্বিতীয়টা চুরির লক্ষণ, কিন্তু কোনটা তা জানা যায় না।
   * তাই নিরাপদ দিকটা বেছে নেওয়া হয়: ওই ইউজারের সব সেশন মুছে দাও।
   */
  async rotateRefreshToken(
    rawToken: string,
    context: RefreshContext = {},
  ): Promise<{ userId: string; refresh: IssuedRefreshToken }> {
    const tokenHash = this.hash(rawToken);

    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, familyId: true, expiresAt: true, revokedAt: true },
    });

    if (!existing) {
      // এই টোকেন কখনো ছিলই না — জাল, বা অনেক আগে purge হয়েছে
      throw new UnauthorizedException('Invalid refresh token');
    }

    /**
     * এইটাই reuse detection। টোকেনটা আগেই rotate হয়ে গেছে, তবু আবার এসেছে।
     * মানে কেউ একটা পুরোনো কপি ধরে বসে আছে — চুরির স্পষ্ট সংকেত।
     * আসল ইউজার আর চোর — কে কোনটা বোঝার উপায় নেই, তাই ওই ইউজারের
     * সব সেশন মুছে দেওয়া হয়। দুজনকেই আবার লগইন করতে হবে, কিন্তু চোরের
     * কাছে পাসওযার্ড নেই, তাই সে আটকে যাবে।
     */
    if (existing.revokedAt) {
      this.logger.warn(
        `Refresh token reuse detected for user ${existing.userId} ` +
          `(family ${existing.familyId}) — revoking all sessions`,
      );

      await this.revokeAllForUser(existing.userId);
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      await this.prisma.refreshToken.delete({ where: { id: existing.id } }).catch(() => undefined);
      throw new UnauthorizedException('Refresh token expired');
    }

    // মুছি না, revoked মার্ক করি — ফিরে এলে যেন চিনতে পারি
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    const refresh = await this.issueRefreshToken(existing.userId, context, existing.familyId);
    return { userId: existing.userId, refresh };
  }

  /**
   * Logout — মুছি না, revoked মার্ক করি।
   * মুছে ফেললে লগআউট-এর পর ওই টোকেন ফিরে এলে "অজানা টোকেন" মনে হত,
   * আর চুরি ধরা পড়ত না।
   */
  async revokeRefreshToken(rawToken: string): Promise<void> {
    await this.prisma.refreshToken
      .update({
        where: { tokenHash: this.hash(rawToken) },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
  }

  /** মেয়াদোত্তীর্ণ row ঝাড়ু — Phase 15-এ cron থেকে ডাকা হবে। */
  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });

    return count;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * secret অবশ্যই থাকতে হবে। না থাকলে fallback দিলে প্রোডাকশনে
   * অনুমানযোগ্য secret নিয়ে চুপচাপ চলতে থাকবে — তার চেয়ে থেমে যাওয়া ভালো।
   */
  private requireSecret(key: string): string {
    const secret = this.config.get<string>(key);

    if (!secret) {
      throw new Error(`${key} is not set — refusing to sign tokens`);
    }

    return secret;
  }

  private parseDays(ttl: string): number {
    const match = /^(\d+)d$/.exec(ttl.trim());
    return match ? Number(match[1]) : 7;
  }

  private parseSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl.trim());

    if (!match) {
      return 900;
    }

    const value = Number(match[1]);
    const unit = match[2];
    const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 60;

    return value * multiplier;
  }
}
