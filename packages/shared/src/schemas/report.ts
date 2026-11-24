import { z } from 'zod';

/**
 * রিপোর্টের input যাচাই ও ফলাফলের টাইপ।
 *
 * **কেন তারিখ নিয়ে এত সতর্কতা:** রিপোর্টের ভুল সংখ্যা সংখ্যা না থাকার
 * চেয়েও খারাপ — কেউ সেটা বিশ্বাস করে সিদ্ধান্ত নেয়। তাই ভুল range
 * নীরবে ঠিক করে দেওয়া হয় না, সরাসরি বলা হয়।
 */

/** এক রিকোয়েস্টে সর্বোচ্চ কত দিন — বছরের তুলনা চলবে, পুরো DB scan নয়। */
export const MAX_REPORT_DAYS = 370;

/** `from`/`to` না দিলে কত দিন পেছনে — খালি স্ক্রিনের চেয়ে কিছু দেখানো ভালো। */
export const DEFAULT_REPORT_DAYS = 30;

/**
 * `YYYY-MM-DD` — ঘণ্টা-মিনিট ছাড়া।
 *
 * ব্যবসা দিনের হিসাবে ভাবে ("১ তারিখ থেকে ৭ তারিখ"), timestamp-এ নয়।
 * সময় অঞ্চলও এড়ানো যায়: সার্ভার দিনটাকে **লোকাল** (ঢাকা) দিন ধরে,
 * ঠিক যেভাবে order number-এ `orderDateKey` ধরে।
 */
export const reportDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'তারিখ YYYY-MM-DD আকারে দিন')
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()), {
    message: 'তারিখটা আসল নয়',
  });

/**
 * তারিখের range।
 *
 * দুটো মাঠই ঐচ্ছিক, কিন্তু একটা দিলে অন্যটাও লাগে — শুধু `from` দিলে
 * "কোন পর্যন্ত" অস্পষ্ট থাকত, আর ডিফল্ট মিশিয়ে দিলে ইউজার যা চেয়েছে
 * তার চেয়ে আলাদা সংখ্যা পেত।
 */
export const reportRangeSchema = z
  .object({
    from: reportDateSchema.optional(),
    to: reportDateSchema.optional(),
  })
  .refine((value) => (value.from === undefined) === (value.to === undefined), {
    message: 'from আর to দুটোই দিন, বা কোনোটাই নয়',
  })
  .refine(
    (value) => value.from === undefined || value.to === undefined || value.from <= value.to,
    {
      // নীরবে উল্টে দেওয়া হয় না — ইউজার ভুল range-এর সংখ্যা
      // বিশ্বাস করে বসলে সেটা আরও বড় ক্ষতি
      message: 'from তারিখ to-র পরে হতে পারে না',
    },
  );

export type ReportRange = z.infer<typeof reportRangeSchema>;

/** best seller-এ কতগুলো পণ্য ফেরত আসবে। */
export const bestSellerQuerySchema = reportRangeSchema.safeExtend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// ---------- ফলাফলের টাইপ ----------

/**
 * টাকার তিনটা আলাদা সংখ্যা।
 *
 * COD ব্যবসায় **এই পার্থক্যটাই আসল কথা**: অর্ডার হওয়া মানে টাকা পাওয়া নয়।
 * একটা সংখ্যা দেখালে হয় আয় ফুলিয়ে দেখানো হতো (ordered), নয় কত টাকার
 * ব্যবসা হচ্ছে সেটা লুকিয়ে যেত (collected)।
 */
export type MoneySummary = {
  /** অ-বাতিল অর্ডারের মোট — কত টাকার অর্ডার এসেছে */
  orderedPaisa: number;
  /** হাতে আসা টাকা — শুধু RECEIVED payment */
  collectedPaisa: number;
  /** বাকি — কখনো ঋণাত্মক নয় */
  duePaisa: number;
};

export type ReportSummary = MoneySummary & {
  orderCount: number;
  /** গড় অর্ডারের আকার। অর্ডার না থাকলে ০ — শূন্য দিয়ে ভাগ নয় */
  averageOrderPaisa: number;
  from: string;
  to: string;
};

/** চার্টের জন্য দিন-ভিত্তিক সারি। */
export type DailySalesPoint = {
  /** YYYY-MM-DD (লোকাল দিন) */
  date: string;
  orderCount: number;
  orderedPaisa: number;
};

export type BestSeller = {
  productName: string;
  variantSku: string;
  quantitySold: number;
  revenuePaisa: number;
};

export type StatusBreakdownRow = {
  status: string;
  orderCount: number;
  totalPaisa: number;
};

export type RepeatCustomer = {
  userId: string;
  name: string | null;
  email: string;
  orderCount: number;
  totalSpentPaisa: number;
};
