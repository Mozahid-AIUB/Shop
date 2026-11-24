import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Coupon, Prisma } from '@prisma/client';
import {
  COUPON_FAILURE,
  COUPON_FAILURE_MESSAGE,
  type CouponDiscount,
  type CouponInput,
  type CouponLike,
  type CouponUpdate,
  type CouponValidateResult,
  computeDiscount,
  evaluateCoupon,
  normalizeCouponCode,
} from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * কুপনের যাচাই ও ব্যবহার লেখা।
 *
 * **নকশার মূল কথা:** ছাড়ের অঙ্ক কখনো ক্লায়েন্ট থেকে নেওয়া হয় না।
 * API শুধু কুপনের **কোড** নেয়, বাকিটা এখানে DB-র নিয়ম দেখে গোনা
 * হয়। নইলে যে কেউ ব্রাউজার থেকে নিজের ছাড় নিজে ঠিক করত।
 *
 * **ব্যবহারের সংখ্যা কখনো `Coupon`-এ জমানো হয় না** — গোনা হয়
 * `CouponRedemption` থেকে, আর গোনা + লেখা একই transaction-এ। দুটো
 * চেকআউট একসাথে এলে তাই দুজনেই শেষ কুপনটা পায় না।
 */

/** যাচাইয়ের সময় লাগে এমন অংশটুকু বেছে নেওয়া। */
type CouponRow = Pick<
  Coupon,
  | 'id'
  | 'code'
  | 'type'
  | 'value'
  | 'maxDiscountPaisa'
  | 'minOrderPaisa'
  | 'startsAt'
  | 'endsAt'
  | 'maxUses'
  | 'maxUsesPerUser'
  | 'isActive'
>;

const toCouponLike = (row: CouponRow): CouponLike => ({
  id: row.id,
  code: row.code,
  type: row.type,
  value: row.value,
  maxDiscountPaisa: row.maxDiscountPaisa,
  minOrderPaisa: row.minOrderPaisa,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  maxUses: row.maxUses,
  maxUsesPerUser: row.maxUsesPerUser,
  isActive: row.isActive,
});

export type ApplyCouponArgs = {
  code: string;
  /**
   * `null` = গেস্ট, অ্যাকাউন্ট ছাড়া কিনছে।
   *
   * তখন "এই ক্রেতা আগে কতবার নিয়েছে" গোনা যায় না, তাই প্রতি-ক্রেতা
   * সীমাওয়ালা কুপন খাটে না — `evaluateCoupon` সেটা `LOGIN_REQUIRED`
   * দিয়ে জানায়।
   */
  userId: string | null;
  subtotalPaisa: number;
  shippingPaisa: number;
};

export type AppliedCoupon = CouponDiscount & { couponId: string; code: string };

@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * কার্টে কোড বসালে কত ছাড় — **কিছু সংরক্ষণ করা হয় না**।
   *
   * এটা শুধু দেখানোর জন্য। আসল সিদ্ধান্ত চেকআউটের transaction-এ
   * আবার নেওয়া হয়, কারণ এর মাঝে কুপন শেষ হয়ে যেতে পারে বা
   * অ্যাডমিন বন্ধ করে দিতে পারে।
   *
   * ব্যর্থ হলেও `200` ফেরে — কারণ "কোড ভুল" ক্রেতার কাছে ত্রুটি নয়,
   * একটা উত্তর। `4xx` দিলে ফ্রন্টএন্ডে বার্তা দেখানো কঠিন হতো।
   */
  async validate(
    code: string,
    userId: string | null,
    amounts: { subtotalPaisa: number; shippingPaisa: number },
  ): Promise<CouponValidateResult> {
    const normalized = normalizeCouponCode(code);
    const coupon = await this.prisma.coupon.findUnique({ where: { code: normalized } });

    if (coupon === null) {
      return this.rejection(normalized, COUPON_FAILURE.NOT_FOUND, null);
    }

    const [totalUses, userUses] = await this.countUses(this.prisma, coupon.id, userId);

    const verdict = evaluateCoupon(toCouponLike(coupon), {
      subtotalPaisa: amounts.subtotalPaisa,
      now: new Date(),
      totalUses,
      userUses,
    });

    if (!verdict.ok) {
      return this.rejection(normalized, verdict.reason, verdict.shortfallPaisa);
    }

    const discount = computeDiscount(verdict.coupon, amounts);

    return {
      ok: true,
      code: normalized,
      discountPaisa: discount.discountPaisa,
      shippingDiscountPaisa: discount.shippingDiscountPaisa,
      message: null,
      shortfallPaisa: null,
    };
  }

  /**
   * চেকআউটে কুপন প্রয়োগ — **অর্ডারের transaction-এর ভেতর থেকে ডাকা হয়**।
   *
   * `tx` বাইরে থেকে নেওয়া হয় ইচ্ছাকৃতভাবে: গোনা আর লেখা একই
   * transaction-এ না হলে দুটো চেকআওট একসাথে এসে দুজনেই শেষ কুপনটা
   * পেয়ে যেত। অর্ডার ব্যর্থ হলে কুপনের ব্যবহারও rollback হয়।
   *
   * এখানে **throw করা হয়** (validate-এর মতো চুপচাপ ফেরা নয়), কারণ
   * ক্রেতা ছাড় দেখে অর্ডার দিয়েছে — ছাড় না দিয়ে অর্ডার নিলে সে
   * বেশি টাকা দিত। অর্ডারটা ভেঙে পড়াই সৎ।
   */
  async apply(tx: Prisma.TransactionClient, args: ApplyCouponArgs): Promise<AppliedCoupon> {
    const normalized = normalizeCouponCode(args.code);
    const coupon = await tx.coupon.findUnique({ where: { code: normalized } });

    if (coupon === null) {
      throw new BadRequestException(COUPON_FAILURE_MESSAGE.NOT_FOUND);
    }

    const [totalUses, userUses] = await this.countUses(tx, coupon.id, args.userId);

    const verdict = evaluateCoupon(toCouponLike(coupon), {
      subtotalPaisa: args.subtotalPaisa,
      now: new Date(),
      totalUses,
      userUses,
    });

    if (!verdict.ok) {
      throw new BadRequestException(COUPON_FAILURE_MESSAGE[verdict.reason]);
    }

    const discount = computeDiscount(verdict.coupon, {
      subtotalPaisa: args.subtotalPaisa,
      shippingPaisa: args.shippingPaisa,
    });

    return {
      couponId: coupon.id,
      code: coupon.code,
      discountPaisa: discount.discountPaisa,
      shippingDiscountPaisa: discount.shippingDiscountPaisa,
    };
  }

  /**
   * ব্যবহার লিখে রাখা — অর্ডার তৈরি হওয়ার পর, **একই transaction-এ**।
   *
   * `orderId @unique` থাকায় একই অর্ডারে দুবার লেখার চেষ্টা DB-তেই
   * আটকায়। সেই সংঘর্ষটা এখানে `ConflictException`-এ রূপ পায়, যাতে
   * ৫০০ না দিয়ে বোঝা যায় কী হলো।
   */
  async recordRedemption(
    tx: Prisma.TransactionClient,
    args: { couponId: string; userId: string | null; orderId: string } & CouponDiscount,
  ): Promise<void> {
    try {
      await tx.couponRedemption.create({
        data: {
          couponId: args.couponId,
          userId: args.userId,
          orderId: args.orderId,
          discountPaisa: args.discountPaisa,
          shippingDiscountPaisa: args.shippingDiscountPaisa,
        },
      });
    } catch {
      throw new ConflictException('এই অর্ডারে কুপন আগেই প্রয়োগ হয়েছে');
    }
  }

  /**
   * ব্যবহারের সংখ্যা — মোট আর এই ক্রেতার।
   *
   * দুটো একসাথে চালানো হয় যাতে transaction-এর ভেতরে অতিরিক্ত
   * round-trip না লাগে।
   */
  private countUses(
    client: Prisma.TransactionClient | PrismaService,
    couponId: string,
    userId: string | null,
  ): Promise<[number, number | null]> {
    return Promise.all([
      client.couponRedemption.count({ where: { couponId } }),
      /**
       * গেস্টের বেলায় `null` — **`0` নয়**।
       *
       * `0` মানে "গোনা হয়েছে, নেয়নি"; `null` মানে "গোনার উপায়ই
       * নেই"। মিলিয়ে ফেললে সীমাওয়ালা কুপন গেস্টের কাছে প্রতিবার
       * "প্রথমবার" দেখাত আর অসীমবার চলত।
       *
       * `where: { userId: null }` দিয়ে গুনলেও ভুল হতো — সেটা **সব
       * গেস্টের** ব্যবহার একসাথে গুনত, মানে এক গেস্ট নিলে পরের
       * গেস্ট আর পেত না।
       */
      userId === null
        ? Promise.resolve(null)
        : client.couponRedemption.count({ where: { couponId, userId } }),
    ]);
  }

  private rejection(
    code: string,
    reason: keyof typeof COUPON_FAILURE_MESSAGE,
    shortfallPaisa: number | null,
  ): CouponValidateResult {
    return {
      ok: false,
      code,
      discountPaisa: 0,
      shippingDiscountPaisa: 0,
      message: COUPON_FAILURE_MESSAGE[reason],
      shortfallPaisa,
    };
  }

  // ─── অ্যাডমিন ───

  listAll(): Promise<Coupon[]> {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /**
   * কুপন তৈরি।
   *
   * কোড ডুপ্লিকেট হলে DB-র `@unique` আটকায়; সেটা `409`-এ রূপ পায়
   * যাতে অ্যাডমিন বোঝে কোডটা আগেই আছে।
   */
  async create(input: CouponInput): Promise<Coupon> {
    const existing = await this.prisma.coupon.findUnique({ where: { code: input.code } });

    if (existing !== null) {
      throw new ConflictException(`"${input.code}" কোডের কুপন আগেই আছে`);
    }

    return this.prisma.coupon.create({ data: input });
  }

  /**
   * কুপন বদলানো। **কোড বদলানো যায় না** — schema-তেই মাঠটা নেই।
   *
   * কোড বদলালে যে ক্রেতারা পুরোনো কোড পেয়েছে তাদের কাছে সেটা হঠাৎ
   * অচল হতো, আর ব্যবহারের ইতিহাসও বিভ্রান্তিকর হতো।
   */
  async update(id: string, input: CouponUpdate): Promise<Coupon> {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });

    if (coupon === null) {
      throw new NotFoundException('কুপন পাওয়া যায়নি');
    }

    const startsAt = input.startsAt === undefined ? coupon.startsAt : input.startsAt;
    const endsAt = input.endsAt === undefined ? coupon.endsAt : input.endsAt;

    // উল্টো মেয়াদ ঠেকানো — আংশিক আপডেটে দুটোর একটাই আসতে পারে
    if (startsAt !== null && endsAt !== null && startsAt > endsAt) {
      throw new BadRequestException('শেষের তারিখ শুরুর আগে হতে পারে না');
    }

    return this.prisma.coupon.update({ where: { id }, data: input });
  }

  /**
   * কুপন মোছা।
   *
   * **ব্যবহার হয়ে যাওয়া কুপন মোছা যায় না** — মুছলে
   * `CouponRedemption` cascade-এ চলে যেত আর পুরোনো অর্ডারে কোন
   * কুপনে ছাড় দেওয়া হয়েছিল তার হিসাব হারিয়ে যেত। বন্ধ করতে
   * `isActive: false` যথেষ্ট।
   */
  async remove(id: string): Promise<void> {
    const used = await this.prisma.couponRedemption.count({ where: { couponId: id } });

    if (used > 0) {
      throw new BadRequestException(
        'এই কুপন ব্যবহার হয়েছে, মোছা যাবে না — বন্ধ করতে নিষ্ক্রিয় করুন',
      );
    }

    const deleted = await this.prisma.coupon.deleteMany({ where: { id } });

    if (deleted.count === 0) {
      throw new NotFoundException('কুপন পাওয়া যায়নি');
    }
  }

  /** কোন কুপন কতবার চলল — অ্যাডমিনের রিপোর্ট। */
  async usageReport(id: string): Promise<{
    couponId: string;
    code: string;
    totalUses: number;
    discountGivenPaisa: number;
    shippingDiscountGivenPaisa: number;
  }> {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });

    if (coupon === null) {
      throw new NotFoundException('কুপন পাওয়া যায়নি');
    }

    const totals = await this.prisma.couponRedemption.aggregate({
      where: { couponId: id },
      _count: { _all: true },
      _sum: { discountPaisa: true, shippingDiscountPaisa: true },
    });

    return {
      couponId: coupon.id,
      code: coupon.code,
      totalUses: totals._count._all,
      // কোনো ব্যবহার না থাকলে `_sum` null আসে
      discountGivenPaisa: totals._sum.discountPaisa ?? 0,
      shippingDiscountGivenPaisa: totals._sum.shippingDiscountPaisa ?? 0,
    };
  }
}
