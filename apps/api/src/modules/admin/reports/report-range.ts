import { BadRequestException } from '@nestjs/common';
import { DEFAULT_REPORT_DAYS, MAX_REPORT_DAYS, type ReportRange } from '@shop/shared';

/** দিনের মিলিসেকেন্ড — পড়তে সহজ রাখার জন্য নাম দেওয়া। */
const DAY_MS = 86_400_000;

export type ResolvedRange = {
  from: Date;
  to: Date;
};

/**
 * `YYYY-MM-DD` → ওই দিনের শুরু, **লোকাল** সময়ে।
 *
 * `new Date('2026-01-01')` UTC মধ্যরাত ধরে — ঢাকায় (UTC+6) সেটা
 * আগের দিনের সন্ধ্যা। তাই দিনটা হাতে ভেঙে লোকাল Date বানানো হয়,
 * ঠিক যেভাবে `orderDateKey` করে।
 */
const startOfLocalDay = (value: string): Date => {
  const [year, month, day] = value.split('-').map(Number);

  // schema আগেই আকার যাচাই করেছে, তাও undefined হলে এখানেই ধরা পড়ুক
  if (year === undefined || month === undefined || day === undefined) {
    throw new BadRequestException('তারিখ YYYY-MM-DD আকারে দিন');
  }

  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

/**
 * input থেকে আসল সময়সীমা।
 *
 * **শেষ দিনটা পুরো ধরা হয়** (২৩:৫৯:৫৯.৯৯৯)। না করলে ওই দিনের সব
 * অর্ডার বাদ পড়ত আর "আজকের বিক্রি ০" দেখাতো — এমন ভুল যা
 * চোখে পড়ে না, কারণ সংখ্যা তো এসেছেই।
 */
export const resolveRange = (input: ReportRange): ResolvedRange => {
  if (input.from === undefined || input.to === undefined) {
    const to = new Date();
    to.setHours(23, 59, 59, 999);

    // আজ **সহ** ৩০ দিন, তাই ২৯ দিন পিছিয়ে যাওয়া হয় —
    // ৩০ দিন পেছালে ৩১ দিনের ডেটা আসত
    const from = new Date(to.getTime() - (DEFAULT_REPORT_DAYS - 1) * DAY_MS);
    from.setHours(0, 0, 0, 0);

    return { from, to };
  }

  const from = startOfLocalDay(input.from);
  const to = startOfLocalDay(input.to);
  to.setHours(23, 59, 59, 999);

  if (from.getTime() > to.getTime()) {
    throw new BadRequestException('from তারিখ to-র পরে হতে পারে না');
  }

  // বড় range-এ পুরো table scan হতো আর প্যানেল ঝুলে থাকত
  const spanDays = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;

  if (spanDays > MAX_REPORT_DAYS) {
    throw new BadRequestException(`এক রিপোর্টে সর্বোচ্চ ${MAX_REPORT_DAYS} দিন`);
  }

  return { from, to };
};
