import { Injectable } from '@nestjs/common';
import type {
  BestSeller,
  DailySalesPoint,
  RepeatCustomer,
  ReportRange,
  ReportSummary,
  StatusBreakdownRow,
} from '@shop/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveRange, type ResolvedRange } from './report-range';

/**
 * ব্যবসার রিপোর্ট — যা ডেটা ইতিমধ্যে জমছে তা পড়া, নতুন কিছু লেখা নয়।
 *
 * **একটা নিয়ম সব query-তে এক:** বাতিল অর্ডার কোনো হিসাবেই নেই।
 * বাতিল অর্ডার বিক্রি নয়; ধরলে আয় ফুলে দেখাতো আর COD ব্যবসায়
 * বাতিলের হার কম নয়।
 *
 * **কেন pre-aggregated table নয়:** দুই জায়গায় সত্য রাখলে তারা আলাদা
 * হয়ে যায় — অর্ডার পরে বাতিল হলে summary row বাসি হয়ে যেত আর
 * রিপোর্ট ভুল বলত। ভুল সংখ্যা সংখ্যা না থাকার চেয়েও খারাপ।
 * ধীর হলে তখন cache বসানো যাবে; বাসি ডেটা থেকে সত্যে ফেরা কঠিন।
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** বাতিল বাদ দিয়ে এই সময়ের অর্ডার — সব query এই শর্তেই চলে। */
  private orderWhere(range: ResolvedRange): {
    status: { not: 'CANCELLED' };
    createdAt: { gte: Date; lte: Date };
  } {
    return {
      status: { not: 'CANCELLED' },
      createdAt: { gte: range.from, lte: range.to },
    };
  }

  /**
   * টাকার তিনটা সংখ্যা + অর্ডারের হিসাব।
   *
   * `ordered` আর `collected` আলাদা রাখা হয় কারণ COD-তে অর্ডার
   * হওয়া মানে টাকা পাওয়া নয়। একটা সংখ্যা দেখালে হয় আয় ফুলিয়ে
   * দেখানো হতো, নয় কত টাকার ব্যবসা হচ্ছে সেটা লুকিয়ে যেত।
   */
  async summary(input: ReportRange): Promise<ReportSummary> {
    const range = resolveRange(input);

    const orders = await this.prisma.order.aggregate({
      where: this.orderWhere(range),
      _sum: { totalPaisa: true },
      _count: true,
    });

    /**
     * হাতে আসা টাকা — শুধু `RECEIVED`। void/refund করা row বাদ,
     * আর payment-এর নিজের তারিখ নয়, **অর্ডারের** তারিখ ধরা হয়,
     * নইলে গত মাসের অর্ডারের আজকের পেমেন্ট এ মাসে গুনে যেত আর
     * due কখনো মিলত না।
     */
    const collected = await this.prisma.payment.aggregate({
      where: {
        status: 'RECEIVED',
        order: this.orderWhere(range),
      },
      _sum: { amountPaisa: true },
    });

    const orderedPaisa = orders._sum.totalPaisa ?? 0;
    const collectedPaisa = collected._sum.amountPaisa ?? 0;
    const orderCount = orders._count;

    return {
      orderedPaisa,
      collectedPaisa,
      // অতিরিক্ত আদায় হলেও due ঋণাত্মক দেখানো অর্থহীন
      duePaisa: Math.max(orderedPaisa - collectedPaisa, 0),
      orderCount,
      // শূন্য দিয়ে ভাগ নয় — অর্ডার না থাকলে গড়ও ০
      averageOrderPaisa: orderCount === 0 ? 0 : Math.round(orderedPaisa / orderCount),
      from: toDateKey(range.from),
      to: toDateKey(range.to),
    };
  }

  /**
   * দিন-ভিত্তিক সিরিজ (চার্টের জন্য)।
   *
   * গোনা হয় **লোকাল** দিনে, নইলে ঢাকার সন্ধ্যার অর্ডার পরের দিনে
   * গুনে যেত। Postgres-এ টাইমজোন নামে বলা হয়, offset লিখে নয় —
   * দিনের আলো সংরক্ষণ বা নিয়ম বদলালেও ঠিক থাকে।
   */
  async dailySales(input: ReportRange): Promise<DailySalesPoint[]> {
    const range = resolveRange(input);

    /**
     * তারিখটা **Postgres-এই** `YYYY-MM-DD` স্ট্রিং বানানো হয়,
     * `Date` object হিসেবে নয়।
     *
     * `Date` ফেরত আনলে JavaScript সেটাকে সার্ভারের লোকাল সময়ে
     * পড়ত — আর সার্ভার প্রায় সবসময় UTC (CI, VPS, Docker)। তখন
     * ঢাকার ভোর ৫টার অর্ডার আগের দিনে দেখাতো। স্ট্রিং করে আনলে
     * মাঝখানে টাইমজোন ঢোকার পথই থাকে না।
     *
     * **দুই ধাপের রূপান্তর কেন:** `createdAt` হলো
     * `timestamp without time zone`, অর্থাৎ ভেতরে টাইমজোনের কোনো
     * তথ্য নেই। Prisma সেখানে **UTC** লেখে। তাই আগে
     * `AT TIME ZONE 'UTC'` দিয়ে বলতে হয় "এটা UTC-র পাঠ", তারপর
     * `AT TIME ZONE 'Asia/Dhaka'` দিয়ে ঢাকায় আনা হয়।
     *
     * শুধু একবার `AT TIME ZONE 'Asia/Dhaka'` দিলে ফল **DB-র নিজের
     * timezone সেটিংয়ের উপর** নির্ভর করত — এই মেশিনে Asia/Dhaka,
     * CI-র container-এ UTC, তাই একই ডেটায় দুই রকম উত্তর আসত
     * (সত্যিই এসেছিল, CI তিনবার ভেঙেছে)।
     */
    const rows = await this.prisma.$queryRaw<
      { date: string; order_count: bigint; ordered_paisa: bigint | null }[]
    >`
      SELECT
        to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS date,
        COUNT(*) AS order_count,
        SUM("totalPaisa") AS ordered_paisa
      FROM orders
      WHERE "status" <> 'CANCELLED'
        AND "createdAt" >= ${range.from}
        AND "createdAt" <= ${range.to}
      GROUP BY 1
      ORDER BY 1
    `;

    return rows.map((row) => ({
      date: row.date,
      orderCount: Number(row.order_count),
      orderedPaisa: Number(row.ordered_paisa ?? 0),
    }));
  }

  /**
   * কোন পণ্য কত বিক্রি হলো।
   *
   * `OrderItem`-এ অর্ডারের সময়কার নাম কপি করা আছে, তাই পণ্য পরে
   * মুছে গেলেও রিপোর্ট পড়া যায় — ইতিহাস ফাঁকা হয়ে যায় না।
   */
  async bestSellers(input: ReportRange, limit: number): Promise<BestSeller[]> {
    const range = resolveRange(input);

    const rows = await this.prisma.$queryRaw<
      {
        product_name: string;
        variant_sku: string;
        quantity_sold: bigint;
        revenue_paisa: bigint;
      }[]
    >`
      SELECT
        oi."productName" AS product_name,
        oi."variantSku"  AS variant_sku,
        SUM(oi."quantity")       AS quantity_sold,
        SUM(oi."lineTotalPaisa") AS revenue_paisa
      FROM order_items oi
      JOIN orders o ON o."id" = oi."orderId"
      WHERE o."status" <> 'CANCELLED'
        AND o."createdAt" >= ${range.from}
        AND o."createdAt" <= ${range.to}
      GROUP BY 1, 2
      ORDER BY quantity_sold DESC, revenue_paisa DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      productName: row.product_name,
      variantSku: row.variant_sku,
      quantitySold: Number(row.quantity_sold),
      revenuePaisa: Number(row.revenue_paisa),
    }));
  }

  /**
   * কোন status-এ কতগুলো অর্ডার আটকে আছে।
   *
   * এটাই কাজের তালিকা: ১২টা অর্ডার `DESIGN_CONFIRMED`-এ বসে থাকলে
   * প্রোডাকশনে চাপ দিতে হবে। এখানে **বাতিলও দেখানো হয়** — কত
   * অর্ডার হারাচ্ছি সেটা জানা দরকার, যদিও টাকার হিসাবে ধরা হয় না।
   */
  async statusBreakdown(input: ReportRange): Promise<StatusBreakdownRow[]> {
    const range = resolveRange(input);

    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
      _sum: { totalPaisa: true },
    });

    return rows
      .map((row) => ({
        status: row.status,
        orderCount: row._count._all,
        totalPaisa: row._sum.totalPaisa ?? 0,
      }))
      .sort((a, b) => b.orderCount - a.orderCount);
  }

  /**
   * একাধিকবার কিনেছে যারা।
   *
   * নতুন ক্রেতা আনার চেয়ে পুরোনো ক্রেতা ধরে রাখা সস্তা, তাই এই
   * তালিকাটা বিজ্ঞাপনের খরচের সিদ্ধান্তে কাজে লাগে।
   */
  async repeatCustomers(input: ReportRange, limit: number): Promise<RepeatCustomer[]> {
    const range = resolveRange(input);

    const rows = await this.prisma.$queryRaw<
      {
        user_id: string;
        name: string | null;
        email: string;
        order_count: bigint;
        total_spent_paisa: bigint;
      }[]
    >`
      SELECT
        u."id"    AS user_id,
        u."name"  AS name,
        u."email" AS email,
        COUNT(o."id")       AS order_count,
        SUM(o."totalPaisa") AS total_spent_paisa
      FROM orders o
      JOIN users u ON u."id" = o."userId"
      WHERE o."status" <> 'CANCELLED'
        AND o."createdAt" >= ${range.from}
        AND o."createdAt" <= ${range.to}
      GROUP BY u."id", u."name", u."email"
      HAVING COUNT(o."id") > 1
      ORDER BY order_count DESC, total_spent_paisa DESC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      orderCount: Number(row.order_count),
      totalSpentPaisa: Number(row.total_spent_paisa),
    }));
  }
}

/** লোকাল দিনের `YYYY-MM-DD` — `toISOString()` UTC-তে নিয়ে যেত। */
const toDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
