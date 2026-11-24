import { z } from 'zod';
import { paisaSchema } from './catalog';
import { DISCOUNT_TYPES } from '../constants/coupon';

/**
 * কুপনের schema।
 *
 * **কিছু হার্ডকোড নয়:** ছাড়ের ধরন, অঙ্ক, মেয়াদ, সীমা — সব অ্যাডমিন
 * ঠিক করে। মালিকের চাওয়া "যখন যেমন ইচ্ছা তেমন অফার", আর এই কোড
 * অন্য ব্যবসায়ীদের কাছেও যাবে — তাদের অফার আলাদা হবে।
 */

/**
 * কুপন কোড।
 *
 * শুধু অক্ষর, সংখ্যা, `-` আর `_` — কারণ কোড ক্রেতা হাতে টাইপ করে
 * আর অনেক সময় URL-এও বসে। ফাঁকা জায়গা বা বিশেষ অক্ষর থাকলে
 * কপি-পেস্টে ভাঙত।
 *
 * **সবসময় বড় হাতে সংরক্ষিত** — `transform` এখানেই করা হয়, যাতে
 * DB-তে কখনো ছোট হাতের কোড না ঢোকে।
 */
export const couponCodeSchema = z
  .string()
  .trim()
  .min(3, 'কোড অন্তত ৩ অক্ষর')
  .max(32, 'কোড ৩২ অক্ষরের বেশি নয়')
  .regex(/^[A-Za-z0-9_-]+$/, 'কোডে শুধু অক্ষর, সংখ্যা, - আর _ চলবে')
  .transform((code) => code.toUpperCase());

const discountTypeSchema = z.enum(DISCOUNT_TYPES);

/**
 * শতাংশ `1..100`-এ বাঁধা।
 *
 * ১০০-র বেশি দিলে ছাড় মোটের চেয়ে বড় হওয়ার চেষ্টা করত — হিসাবে
 * `Math.min` সেটা আটকায়, কিন্তু এখানেই আটকানো ভালো: অ্যাডমিন
 * ভুল করে `1000` লিখে ফেললে সাথে সাথে জানতে পারে।
 */
const percentValueSchema = z
  .number()
  .int('শতাংশ পূর্ণসংখ্যা হবে')
  .min(1, 'শতাংশ অন্তত ১')
  .max(100, 'শতাংশ ১০০-র বেশি নয়');

const couponShape = {
  code: couponCodeSchema,
  description: z.string().trim().max(200).nullable().default(null),

  type: discountTypeSchema,

  /**
   * `PERCENT`-এ শতাংশ, `FIXED`-এ paisa, `FREE_SHIPPING`-এ অব্যবহৃত।
   *
   * ধরন অনুযায়ী সীমা আলাদা, তাই নিচে `superRefine`-এ আবার যাচাই হয়।
   */
  value: z.number().int('অঙ্ক পূর্ণসংখ্যা হবে').min(0, 'অঙ্ক ঋণাত্মক নয়').default(0),

  maxDiscountPaisa: paisaSchema.nullable().default(null),
  minOrderPaisa: paisaSchema.default(0),

  startsAt: z.coerce.date().nullable().default(null),
  endsAt: z.coerce.date().nullable().default(null),

  /** `null` = সীমা নেই */
  maxUses: z.number().int().min(1, 'সর্বোচ্চ ব্যবহার অন্তত ১').nullable().default(null),
  /**
   * `null` = প্রতি-ক্রেতা সীমা নেই, তখন **গেস্টও** কুপনটা পায়।
   *
   * ডিফল্ট `1` — অ্যাডমিন কিছু না বললে কুপন একজনের একবার, কারণ
   * সেটাই নিরাপদ অনুমান। গেস্টকেও দিতে চাইলে স্পষ্ট করে `null`
   * পাঠাতে হবে, যাতে সিদ্ধান্তটা ইচ্ছাকৃত হয়।
   */
  maxUsesPerUser: z.number().int().min(1, 'প্রতি ক্রেতা অন্তত ১').nullable().default(1),

  isActive: z.boolean().default(true),
};

/**
 * ধরন-নির্ভর নিয়মগুলো।
 *
 * একই মাঠ `value` তিন ধরনে তিন অর্থ বহন করে, তাই schema-র সাধারণ
 * নিয়মে ধরা পড়ে না — এখানে আলাদা করে যাচাই করা হয়। না করলে
 * অ্যাডমিন `PERCENT` কুপনে `value: 0` বসিয়ে এমন কুপন বানাত যা
 * কোনো ছাড়ই দেয় না, আর ক্রেতা বলত "কুপন কাজ করছে না"।
 */
const refineCoupon = (
  data: {
    type: string;
    value: number;
    startsAt: Date | null;
    endsAt: Date | null;
    maxDiscountPaisa: number | null;
  },
  ctx: z.RefinementCtx,
): void => {
  if (data.type === 'PERCENT') {
    const parsed = percentValueSchema.safeParse(data.value);

    if (!parsed.success) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: parsed.error.issues[0]?.message ?? 'শতাংশ ১ থেকে ১০০-র মধ্যে',
      });
    }
  }

  if (data.type === 'FIXED' && data.value < 1) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'ছাড়ের অঙ্ক দিন' });
  }

  /**
   * `maxDiscountPaisa` শুধু `PERCENT`-এ অর্থবহ। `FIXED`-এ অঙ্কটাই
   * নির্দিষ্ট, আর `FREE_SHIPPING`-এ পণ্যে ছাড়ই নেই — সেখানে সীমা
   * বসালে অ্যাডমিন ভাবত সেটা কাজ করছে, আসলে উপেক্ষা হতো।
   */
  if (data.type !== 'PERCENT' && data.maxDiscountPaisa !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['maxDiscountPaisa'],
      message: 'সর্বোচ্চ ছাড়ের সীমা শুধু শতাংশ কুপনে দেওয়া যায়',
    });
  }

  // উল্টো মেয়াদ কখনো চলবে না — চুপচাপ অদলবদল করা হয় না
  if (data.startsAt !== null && data.endsAt !== null && data.startsAt > data.endsAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'শেষের তারিখ শুরুর আগে হতে পারে না',
    });
  }
};

export const couponInputSchema = z.object(couponShape).superRefine(refineCoupon);

/**
 * আপডেট — যা পাঠানো হয়নি তা **অপরিবর্তিত** থাকবে।
 *
 * **`couponInputSchema.partial()` ব্যবহার করা যায় না।** Zod-এ
 * `.partial()` মাঠ ঐচ্ছিক করে কিন্তু `.default()` সরায় না, তাই শুধু
 * `{ isActive: false }` পাঠালেও বাকি সব মাঠে default বসে যেত —
 * মেয়াদ মুছে যেত, `minOrderPaisa` ০ হয়ে যেত। Phase 14-এ ঠিক এই
 * বাগটা শিপিং zone-এ ধরা পড়েছিল, তাই এখানে প্রতিটা মাঠ আলাদা করে
 * লেখা, কোনো default ছাড়া।
 */
export const couponUpdateSchema = z.object({
  description: z.string().trim().max(200).nullable().optional(),
  value: z.number().int().min(0).optional(),
  maxDiscountPaisa: paisaSchema.nullable().optional(),
  minOrderPaisa: paisaSchema.optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  maxUses: z.number().int().min(1).nullable().optional(),
  maxUsesPerUser: z.number().int().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * কোডটা **বদলানো যায় না** — ইচ্ছাকৃত।
 *
 * কোড বদলালে যে ক্রেতারা পুরোনো কোড পেয়েছে তাদের কাছে সেটা হঠাৎ
 * অচল হয়ে যেত, আর `CouponRedemption`-এর ইতিহাসও বিভ্রান্তিকর হতো।
 * নতুন কোড লাগলে নতুন কুপন বানানো সঠিক পথ।
 */

/** ক্রেতা কার্টে কোড বসিয়ে দেখতে চায় কত ছাড় পাবে। */
export const couponValidateSchema = z.object({
  code: couponCodeSchema,
});

export type CouponInput = z.infer<typeof couponInputSchema>;
export type CouponUpdate = z.infer<typeof couponUpdateSchema>;
export type CouponValidateInput = z.infer<typeof couponValidateSchema>;

/** কার্টে দেখানোর জন্য যাচাইয়ের ফল। */
export type CouponValidateResult = {
  ok: boolean;
  code: string;
  /** পণ্যের দামে ছাড়, paisa */
  discountPaisa: number;
  /** ডেলিভারিতে ছাড়, paisa */
  shippingDiscountPaisa: number;
  /** খাটলে `null`, নইলে ক্রেতাকে দেখানোর বার্তা */
  message: string | null;
  /** `BELOW_MINIMUM`-এ আর কত টাকার কিনলে চলত */
  shortfallPaisa: number | null;
};
