import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { assessFraud, type FraudAssessment, type FraudSignals } from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';

/** "বড় অর্ডার" কত থেকে — দোকানভেদে আলাদা, তাই `.env`-এ। ডিফল্ট ৫০০০ টাকা। */
const DEFAULT_LARGE_ORDER_PAISA = 500_000;

/** গত কত ঘণ্টার অর্ডারকে "দ্রুত" ধরা হবে। */
const RAPID_WINDOW_HOURS = 24;

/**
 * COD ঝুঁকির হিসাব।
 *
 * **এটা কখনো অর্ডার আটকায় না।** স্কোর শুধু অ্যাডমিনকে বলে
 * "এটা একটু দেখে নিন" — সিদ্ধান্ত মানুষের। কারণ আসল ক্রেতাকে
 * ভুল করে আটকানোর ক্ষতি অদৃশ্য ও স্থায়ী: সে অভিযোগ করতে আসে না,
 * চুপচাপ অন্য দোকানে চলে যায়।
 *
 * **হিসাব transaction-এর বাইরে** হয়, অর্ডার তৈরির পরে। ঝুঁকির
 * হিসাব ভেঙে গেলে অর্ডারও ভেঙে যাওয়া অর্থহীন হতো — কাস্টমারের
 * দোষ নেই, আর টাকাও হাতছাড়া হতো।
 */
@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);

  constructor(private readonly prisma: PrismaService) {}

  private largeOrderPaisa(): number {
    const configured = Number(process.env.FRAUD_LARGE_ORDER_PAISA);

    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_LARGE_ORDER_PAISA;
  }

  /**
   * অর্ডারের ঝুঁকি হিসাব করে সংরক্ষণ করে।
   *
   * **কখনো throw করে না** — checkout-এর পরে ডাকা হয়, আর এখানে
   * কিছু ভাঙলে কাস্টমারের সফল অর্ডার ব্যর্থ দেখানো হতো।
   */
  async checkOrder(orderId: string): Promise<FraudAssessment | null> {
    try {
      const signals = await this.gatherSignals(orderId);

      if (signals === null) {
        return null;
      }

      const assessment = assessFraud(signals);

      await this.prisma.fraudCheck.create({
        data: {
          orderId,
          score: assessment.score,
          level: assessment.level,
          reasons: assessment.reasons,
        },
      });

      if (assessment.level === 'HIGH') {
        // অ্যাডমিন প্যানেলে দেখার আগেই log-এ থাকুক
        this.logger.warn(
          `Order ${orderId} scored ${assessment.score} (${assessment.level}) — worth a call`,
        );
      }

      return assessment;
    } catch (error) {
      // অর্ডার হয়ে গেছে; ঝুঁকির হিসাব না হলেও সেটা বাতিল হবে না
      this.logger.error(
        `Could not assess order ${orderId}: ${error instanceof Error ? error.message : 'unknown'}`,
      );

      return null;
    }
  }

  /** DB থেকে সংকেতগুলো জোগাড়। */
  private async gatherSignals(orderId: string): Promise<FraudSignals | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        userId: true,
        totalPaisa: true,
        shipPhone: true,
        shipLine1: true,
        shipCity: true,
        createdAt: true,
        user: { select: { createdAt: true } },
      },
    });

    if (order === null) {
      return null;
    }

    const since = new Date(order.createdAt.getTime() - RAPID_WINDOW_HOURS * 3_600_000);

    /**
     * ক্রেতাকে চেনার শর্ত — **গেস্ট আর সদস্যের জন্য আলাদা**।
     *
     * সদস্যকে `userId` ধরে চেনা যায়। গেস্টের সেটা নেই, তাই ফোন
     * নম্বরই তার একমাত্র পরিচয়।
     *
     * **`userId: null` দিয়ে কখনো খোঁজা যাবে না** — সেটা **সব
     * গেস্টের** অর্ডার একসাথে গুনত, মানে এক গেস্টের বাতিল অর্ডারের
     * দোষ বাকি সব গেস্টের ঘাড়ে পড়ত আর সবাই HIGH ঝুঁকি দেখাত।
     *
     * ফোন ধরে গোনাটা আসলে **শক্ত** সংকেত: নতুন অ্যাকাউন্ট খোলা
     * সহজ, কিন্তু নম্বর বদলানো কঠিন।
     */
    const identity: Prisma.OrderWhereInput =
      order.userId === null ? { shipPhone: order.shipPhone } : { userId: order.userId };

    /** "অন্য কেউ" — সদস্যের বেলায় অন্য অ্যাকাউন্ট, গেস্টের বেলায় অন্য ফোন। */
    const someoneElse: Prisma.OrderWhereInput =
      order.userId === null
        ? { shipPhone: { not: order.shipPhone } }
        : { userId: { not: order.userId } };

    const [failedOrders, successfulOrders, recentOrderCount, addressUsedByOthers] =
      await Promise.all([
        /**
         * বাতিল হওয়া অর্ডার।
         *
         * **সীমাবদ্ধতা, জেনে রাখা দরকার:** এখন schema-তে "কে বাতিল
         * করল" আলাদা নেই, তাই কাস্টমারের নিজের মত বদলানো আর কুরিয়ার
         * থেকে ফেরত আসা — দুটোই একই রকম গোনা হয়। মত বদলানো
         * স্বাভাবিক, জালিয়াতি নয়।
         *
         * এর ক্ষতি সীমিত রাখা হয়েছে দুভাবে: স্কোর কখনো অর্ডার
         * আটকায় না, আর সফল ডেলিভারি স্কোর কমিয়ে দেয়। তবু
         * Phase 10-এ কুরিয়ারের return তথ্য এলে এটা আলাদা করা উচিত —
         * তখন "নেয়নি" আর "বাতিল করেছে" আলাদা সংকেত হবে।
         */
        this.prisma.order.count({
          where: { ...identity, status: 'CANCELLED' },
        }),

        this.prisma.order.count({
          where: { ...identity, status: 'DELIVERED' },
        }),

        /**
         * একই **ফোনে** গোনা হয়, ইউজারে নয় — নতুন অ্যাকাউন্ট খুলে
         * একই ফোন ব্যবহার করলেও ধরা পড়ে।
         */
        this.prisma.order.count({
          where: {
            shipPhone: order.shipPhone,
            createdAt: { gte: since, lte: order.createdAt },
          },
        }),

        /**
         * একই ঠিকানা অন্য অ্যাকাউন্ট ব্যবহার করেছে কিনা।
         * পুরো ঠিকানা মেলানো হয় না (বানান আলাদা হয়) — বাড়ির
         * লাইন আর শহর মিললেই যথেষ্ট ইঙ্গিত।
         */
        this.prisma.order
          .findFirst({
            where: {
              shipLine1: order.shipLine1,
              shipCity: order.shipCity,
              ...someoneElse,
            },
            select: { id: true },
          })
          .then((found) => found !== null),
      ]);

    /**
     * গেস্টের অ্যাকাউন্ট নেই, তাই বয়সও নেই — `null`।
     *
     * `0` দেওয়া যেত না: তাহলে প্রতিটা গেস্ট অর্ডার "আজ খোলা
     * অ্যাকাউন্ট" হিসেবে গোনা হতো, আর অ্যাডমিন প্যানেলে "অ্যাকাউন্ট
     * ০ দিনের" লেখা দেখে বিভ্রান্ত হতো। `assessFraud` `null`-কে
     * আলাদা সংকেত হিসেবে দেখে।
     */
    const accountAgeDays =
      order.user === null
        ? null
        : Math.floor((order.createdAt.getTime() - order.user.createdAt.getTime()) / 86_400_000);

    return {
      failedOrders,
      successfulOrders,
      // এই অর্ডারটা নিজেই গোনায় আছে, তাই আগেরগুলো বাদ দেওয়ার দরকার নেই
      recentOrderCount,
      accountAgeDays,
      orderTotalPaisa: order.totalPaisa,
      largeOrderPaisa: this.largeOrderPaisa(),
      addressUsedByOthers,
    };
  }
}
