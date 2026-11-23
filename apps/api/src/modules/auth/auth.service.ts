import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type { AuthResponse, AuthUser, LoginInput, RegisterInput } from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService, type IssuedRefreshToken, type RefreshContext } from './token.service';

/** ক্লায়েন্টে যা যাবে — `password` ইচ্ছাকৃতভাবে বাদ। */
const USER_FIELDS = {
  id: true,
  email: true,
  name: true,
  phone: true,
  role: true,
  isActive: true,
} as const;

/**
 * argon2id — OWASP-এর সুপারিশ করা প্যারামিটার।
 * 19 MiB মেমরি, ২ পাস। কম দিলে GPU-তে brute force সহজ হয়ে যায়।
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterInput, context: RefreshContext = {}): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    // রেজিস্ট্রেশনে "ইমেইল আছে" বলা ঠিক আছে — নইলে ইউজার বুঝবে না কেন আটকাচ্ছে।
    // লগইনে এটা বলা যাবে না, সেখানে enumeration-এর ঝুঁকি।
    if (existing) {
      throw new ConflictException('This email is already registered');
    }

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        phone: input.phone ?? null,
        password: await argon2.hash(input.password, ARGON2_OPTIONS),
        // role ইচ্ছাকৃতভাবে সেট করা হয়নি — schema-র default CUSTOMER থাকবে।
        // ক্লায়েন্টের পাঠানো role এখানে পৌঁছায়ও না, Zod schema-তেই বাদ পড়ে যায়।
      },
      select: USER_FIELDS,
    });

    return this.issueSession(user, context);
  }

  async login(input: LoginInput, context: RefreshContext = {}): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { ...USER_FIELDS, password: true },
    });

    // ইউজার না থাকলেও hash যাচাই করা হয় — না করলে উত্তর আসার সময় দেখে
    // বোঝা যায় ইমেইলটা রেজিস্টার্ড কিনা (timing attack)।
    const hash = user?.password ?? DUMMY_HASH;
    const passwordMatches = await argon2.verify(hash, input.password).catch(() => false);

    // তিনটা কারণেই একই বার্তা — কোনটা ভুল তা ফাঁস করা যাবে না
    if (!user || !passwordMatches || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // password ফিল্ডটা এখানেই ঝরে যায় — কোনো response-এ পৌঁছাতে পারবে না
    return this.issueSession(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
      },
      context,
    );
  }

  /**
   * Rotation। পুরোনো টোকেন revoked হয়, নতুন একটা একই family-তে জন্মায়।
   * একই টোকেন দ্বিতীয়বার এলে `TokenService` সেটা ধরে ওই ইউজারের সব সেশন মুছে দেয়।
   */
  async refresh(rawToken: string, context: RefreshContext = {}): Promise<AuthResult> {
    const { userId, refresh } = await this.tokens.rotateRefreshToken(rawToken, context);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_FIELDS,
    });

    // rotate হওয়ার পর ইউজার মুছে গেছে বা নিষ্ক্রিয় — নতুন টোকেনটাও বাতিল করতে হবে
    if (!user || !user.isActive) {
      await this.tokens.revokeAllForUser(userId);
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      response: {
        accessToken: await this.tokens.signAccessToken({
          sub: user.id,
          email: user.email,
          role: user.role,
        }),
        expiresIn: this.tokens.accessTokenLifetimeSeconds(),
        user,
      },
      refresh,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) {
      await this.tokens.revokeRefreshToken(rawToken);
    }
  }

  async findById(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: USER_FIELDS,
    });

    // টোকেন বৈধ কিন্তু ইউজার নেই/নিষ্ক্রিয় — অ্যাকাউন্ট মোছার পরেও পুরোনো টোকেন
    // ১৫ মিনিট বাঁচে, তাই এখানে আবার যাচাই করা হয়
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is no longer active');
    }

    return user;
  }

  private async issueSession(user: AuthUser, context: RefreshContext): Promise<AuthResult> {
    const [accessToken, refresh] = await Promise.all([
      this.tokens.signAccessToken({ sub: user.id, email: user.email, role: user.role }),
      this.tokens.issueRefreshToken(user.id, context),
    ]);

    return {
      response: {
        accessToken,
        expiresIn: this.tokens.accessTokenLifetimeSeconds(),
        user,
      },
      refresh,
    };
  }
}

export interface AuthResult {
  response: AuthResponse;
  refresh: IssuedRefreshToken;
}

/**
 * অস্তিত্বহীন ইউজারের জন্য যাচাই করার মতো একটা আসল argon2 hash।
 * এটা ছাড়া অজানা ইমেইলে উত্তর দ্রুত আসত আর সেই পার্থক্য দিয়ে
 * কোন ইমেইল রেজিস্টার্ড তা বের করা যেত।
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$Zm9yY29uc3RhbnR0aW1lY29tcGFyaXNvbg';
