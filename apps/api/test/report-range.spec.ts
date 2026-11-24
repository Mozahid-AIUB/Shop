import {
  bestSellerQuerySchema,
  DEFAULT_REPORT_DAYS,
  MAX_REPORT_DAYS,
  reportRangeSchema,
} from '@shop/shared';
import { resolveRange } from '../src/modules/admin/reports/report-range';

/**
 * তারিখের range — DB ছাড়াই যাচাই করা যায়।
 *
 * **কেন আলাদা করে এত টেস্ট:** রিপোর্টের ভুল সংখ্যা সংখ্যা না থাকার
 * চেয়েও খারাপ। কেউ সেটা বিশ্বাস করে সিদ্ধান্ত নেয়, আর ভুলটা
 * ধরাও পড়ে না — সংখ্যা তো এসেছেই।
 */
describe('report range schema', () => {
  it('accepts a normal range', () => {
    const result = reportRangeSchema.safeParse({ from: '2026-01-01', to: '2026-01-31' });

    expect(result.success).toBe(true);
  });

  it('accepts no range at all', () => {
    expect(reportRangeSchema.safeParse({}).success).toBe(true);
  });

  /** একটা দিলে অন্যটা ছাড়া "কোন পর্যন্ত" অস্পষ্ট থেকে যায়। */
  it('rejects half a range', () => {
    expect(reportRangeSchema.safeParse({ from: '2026-01-01' }).success).toBe(false);
    expect(reportRangeSchema.safeParse({ to: '2026-01-31' }).success).toBe(false);
  });

  /**
   * উল্টো range নীরবে ঠিক করে দেওয়া হয় না। করলে ইউজার যে range
   * চায়নি সেটার সংখ্যা পেত আর জানতেও পারত না।
   */
  it('rejects a backwards range instead of quietly swapping it', () => {
    const result = reportRangeSchema.safeParse({ from: '2026-02-01', to: '2026-01-01' });

    expect(result.success).toBe(false);
  });

  it('allows a single day', () => {
    const result = reportRangeSchema.safeParse({ from: '2026-01-15', to: '2026-01-15' });

    expect(result.success).toBe(true);
  });

  it('rejects a date that is not a real date', () => {
    expect(reportRangeSchema.safeParse({ from: '2026-13-45', to: '2026-13-46' }).success).toBe(
      false,
    );
  });

  it('rejects a timestamp — reports work in whole days', () => {
    const result = reportRangeSchema.safeParse({
      from: '2026-01-01T10:00:00Z',
      to: '2026-01-31',
    });

    expect(result.success).toBe(false);
  });
});

describe('best seller query', () => {
  it('defaults to ten products', () => {
    const result = bestSellerQuerySchema.parse({});

    expect(result.limit).toBe(10);
  });

  /** উপরে সীমা না থাকলে `limit=100000` দিয়ে DB আটকানো যেত। */
  it('refuses an unbounded limit', () => {
    expect(bestSellerQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });
});

/**
 * `resolveRange` — schema-র পাস করা input থেকে আসল সময়সীমা।
 *
 * এখানেই সেই দুটো ভুল ধরা পড়ে যেগুলো চোখে পড়ে না: শেষ দিনটা বাদ
 * পড়ে যাওয়া, আর অতিরিক্ত বড় range দিয়ে DB-কে কাবু করা।
 */
describe('resolveRange', () => {
  it('falls back to the last thirty days', () => {
    const range = resolveRange({});

    // শেষ দিন পুরো ধরা হয় বলে পার্থক্য ঠিক পূর্ণ দিন নয় — উপরে তোলা হয়
    const days = Math.ceil((range.to.getTime() - range.from.getTime()) / 86_400_000);

    // "শেষ ৩০ দিন" মানে **আজ সহ** ৩০ দিন, ৩১ নয়
    expect(days).toBe(DEFAULT_REPORT_DAYS);
  });

  /**
   * **সবচেয়ে সহজে হওয়া ভুল:** `to` কে ওই দিনের ০০:০০ ধরলে ওই
   * দিনের সব অর্ডার বাদ পড়ে যেত — "আজকের বিক্রি ০" দেখাতো।
   */
  it('includes the whole of the last day', () => {
    const range = resolveRange({ from: '2026-01-01', to: '2026-01-01' });

    expect(range.from.getHours()).toBe(0);
    expect(range.from.getMinutes()).toBe(0);
    expect(range.to.getHours()).toBe(23);
    expect(range.to.getMinutes()).toBe(59);
    // একই দিন — কিন্তু range শূন্য নয়
    expect(range.to.getTime()).toBeGreaterThan(range.from.getTime());
  });

  it('uses the dates it was given', () => {
    const range = resolveRange({ from: '2026-03-10', to: '2026-03-20' });

    expect(range.from.getFullYear()).toBe(2026);
    expect(range.from.getMonth()).toBe(2); // মার্চ
    expect(range.from.getDate()).toBe(10);
    expect(range.to.getDate()).toBe(20);
  });

  /** বড় range-এ পুরো table scan হতো আর অ্যাডমিন প্যানেল ঝুলে থাকত। */
  it('refuses a range longer than the limit', () => {
    expect(() => resolveRange({ from: '2020-01-01', to: '2026-01-01' })).toThrow();
  });

  it('allows a year — comparing years is a real need', () => {
    expect(() => resolveRange({ from: '2026-01-01', to: '2026-12-31' })).not.toThrow();
  });

  it('allows exactly the maximum span', () => {
    const from = new Date(2026, 0, 1);
    const to = new Date(from.getTime() + (MAX_REPORT_DAYS - 1) * 86_400_000);
    const iso = (date: Date): string =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate(),
      ).padStart(2, '0')}`;

    expect(() => resolveRange({ from: iso(from), to: iso(to) })).not.toThrow();
  });
});
