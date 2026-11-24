/**
 * কুপনের হিসাব ও শর্ত যাচাই।
 *
 * **কেন নিয়মটা shared-এ:** কার্টের পাতায় "SAVE50 বসালে ৫০ টাকা
 * ছাড়" দেখাতে হয় চেকআউটের আগেই। দুই জায়গায় দুই নিয়ম লিখলে কার্টে
 * এক আর অর্ডারে আরেক অঙ্ক দেখাত।
 *
 * **ছাড়ের অঙ্ক কখনো ক্লায়েন্ট থেকে নেওয়া হয় না** — ব্রাউজার থেকে
 * `discountPaisa` পাঠানো গেলে যে কেউ নিজের ছাড় নিজে ঠিক করত। API
 * শুধু কুপনের **কোড** নেয়, বাকিটা সার্ভারে গোনা হয়।
 */

/** কুপন কী ধরনের ছাড় দেয়। Prisma-র `DiscountType` enum-এর সাথে মিলে। */
export const DISCOUNT_TYPES = ['PERCENT', 'FIXED', 'FREE_SHIPPING'] as const;

export type DiscountType = (typeof DISCOUNT_TYPES)[number];

/** যাচাইয়ের জন্য কুপনের দরকারি অংশটুকু। */
export type CouponLike = {
  id: string;
  code: string;
  type: DiscountType;
  /** `PERCENT`-এ শতাংশ, `FIXED`-এ paisa, `FREE_SHIPPING`-এ অব্যবহৃত */
  value: number;
  /** `PERCENT`-এর সর্বোচ্চ ছাড়। `null` = সীমা নেই */
  maxDiscountPaisa: number | null;
  minOrderPaisa: number;
  startsAt: Date | null;
  endsAt: Date | null;
  /** সব মিলিয়ে সর্বোচ্চ কতবার। `null` = সীমা নেই */
  maxUses: number | null;
  /**
   * একজন ক্রেতা সর্বোচ্চ কতবার। `null` = প্রতি-ক্রেতা সীমা নেই।
   *
   * `null` রাখলে কুপনটা **গেস্টও** পায়, কারণ তখন কারো ব্যবহার গোনার
   * দরকারই নেই। সীমা বসালে কুপন লগইন করা ক্রেতার জন্য সংরক্ষিত
   * হয়ে যায় — অ্যাডমিনের ইচ্ছামতো।
   */
  maxUsesPerUser: number | null;
  isActive: boolean;
};

/**
 * কুপন খাটল না কেন।
 *
 * কোড আলাদা করে রাখা হয় যাতে UI নিজের ভাষায় বার্তা দেখাতে পারে,
 * আর ভবিষ্যতে নতুন কারণ যোগ করলে কম্পাইলারই ধরিয়ে দেয়।
 */
export const COUPON_FAILURE = {
  NOT_FOUND: 'NOT_FOUND',
  INACTIVE: 'INACTIVE',
  NOT_STARTED: 'NOT_STARTED',
  EXPIRED: 'EXPIRED',
  BELOW_MINIMUM: 'BELOW_MINIMUM',
  EXHAUSTED: 'EXHAUSTED',
  ALREADY_USED: 'ALREADY_USED',
  /**
   * প্রতি-ক্রেতা সীমাওয়ালা কুপন, কিন্তু ক্রেতার পরিচয় নেই (গেস্ট)।
   *
   * গেস্টের `userId` নেই, তাই "এই ক্রেতা কতবার নিয়েছে" গোনার কোনো
   * উপায় নেই। চুপচাপ সীমাটা উপেক্ষা করলে একজনই পুরো ক্যাম্পেইন খেয়ে
   * ফেলত — incognito খুলে যতবার ইচ্ছা। স্পষ্ট প্রত্যাখ্যানই সৎ:
   * ক্রেতা লগইন করে নিলেই কুপনটা পাবে।
   *
   * অ্যাডমিন চাইলে কুপনে `maxUsesPerUser: null` দিয়ে প্রতি-ক্রেতা
   * সীমা তুলে দিতে পারে — তখন গেস্টও পায়।
   */
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
} as const;

export type CouponFailure = (typeof COUPON_FAILURE)[keyof typeof COUPON_FAILURE];

/** ক্রেতাকে দেখানোর বার্তা — প্রতিটা কারণের জন্য একটা। */
export const COUPON_FAILURE_MESSAGE: Record<CouponFailure, string> = {
  NOT_FOUND: 'কুপন কোডটা ঠিক নেই',
  INACTIVE: 'এই কুপন এখন চালু নেই',
  NOT_STARTED: 'এই কুপন এখনো শুরু হয়নি',
  EXPIRED: 'এই কুপনের মেয়াদ শেষ',
  BELOW_MINIMUM: 'অর্ডারের অঙ্ক কুপনের ন্যূনতমের চেয়ে কম',
  EXHAUSTED: 'এই কুপন আর অবশিষ্ট নেই',
  ALREADY_USED: 'এই কুপন আপনি আগেই ব্যবহার করেছেন',
  LOGIN_REQUIRED: 'এই কুপন ব্যবহার করতে লগইন করুন',
};

export type CouponDiscount = {
  /** পণ্যের দামে ছাড়, paisa */
  discountPaisa: number;
  /**
   * ডেলিভারি চার্জে ছাড়, paisa।
   *
   * **আলাদা রাখা ইচ্ছাকৃত।** `discountPaisa`-তে মিশিয়ে দিলে
   * ইনভয়েসে "ডেলিভারি ৬০৳" আর "ছাড় ৬০৳" — দুটোই দেখাত, আর
   * কুরিয়ারের বিলের সাথে হিসাব মেলানো কঠিন হতো।
   */
  shippingDiscountPaisa: number;
};

export type CouponEvaluation =
  | { ok: true; coupon: CouponLike }
  | {
      ok: false;
      reason: CouponFailure;
      /** `BELOW_MINIMUM`-এ আর কত টাকার কিনলে চলত। নইলে `null` */
      shortfallPaisa: number | null;
    };

export type CouponContext = {
  /** **ছাড়ের আগের** পণ্যের মোট */
  subtotalPaisa: number;
  now: Date;
  /** এই কুপন সব মিলিয়ে কতবার ব্যবহার হয়েছে */
  totalUses: number;
  /**
   * এই ক্রেতা কতবার ব্যবহার করেছে।
   *
   * `null` মানে **গোনা যায় না** — গেস্ট, তার কোনো `userId` নেই।
   * `0` আর `null` আলাদা: `0` মানে "চেক করা হয়েছে, নেয়নি", `null`
   * মানে "চেক করার উপায়ই নেই"। একসাথে মিলিয়ে ফেললে সীমাওয়ালা কুপন
   * গেস্টের কাছে অসীমবার চলত।
   */
  userUses: number | null;
};

/**
 * কোড স্বাভাবিক করা।
 *
 * ক্রেতা হাতে টাইপ করে বা কপি-পেস্ট করে, তাই ফাঁকা জায়গা আর ছোট
 * হাতের অক্ষর আসে। DB-তে সবসময় বড় হাতে রাখা হয়, তাই খোঁজাও
 * বড় হাতে।
 */
export const normalizeCouponCode = (code: string): string => code.trim().toUpperCase();

/**
 * ছাড়ের অঙ্ক।
 *
 * `subtotalPaisa` **ছাড়ের আগের** অঙ্ক, আর `shippingPaisa` Phase 14-র
 * quote থেকে আসা চার্জ।
 */
export const computeDiscount = (
  coupon: CouponLike,
  amounts: { subtotalPaisa: number; shippingPaisa: number },
): CouponDiscount => {
  const { subtotalPaisa, shippingPaisa } = amounts;

  if (coupon.type === 'FREE_SHIPPING') {
    // চার্জ আগেই ০ হলে বাড়তি কিছু নেই — ঋণাত্মক ছাড় হতে পারে না
    return { discountPaisa: 0, shippingDiscountPaisa: Math.max(shippingPaisa, 0) };
  }

  /**
   * শতাংশে ভাঙা পয়সা আসে — `floor` দিয়ে **নিচের দিকে** নেওয়া হয়।
   * উপরে নিলে প্রতি অর্ডারে এক পয়সা করে বেশি ছাড় যেত, যা বহু
   * অর্ডারে জমে হিসাব মেলানো কঠিন করত।
   */
  const raw =
    coupon.type === 'PERCENT'
      ? Math.floor((subtotalPaisa * coupon.value) / 100)
      : coupon.value;

  const capped = coupon.maxDiscountPaisa === null ? raw : Math.min(raw, coupon.maxDiscountPaisa);

  /**
   * **এটাই সবচেয়ে দরকারি সীমা।** ছাড় subtotal-এর চেয়ে বড় হলে
   * total ঋণাত্মক হতো — মানে দোকান ক্রেতাকে টাকা দিচ্ছে। `max(…, 0)`
   * ঋণাত্মক `value` ভুলে বসানো হলেও রক্ষা করে।
   */
  return {
    discountPaisa: Math.min(Math.max(capped, 0), subtotalPaisa),
    shippingDiscountPaisa: 0,
  };
};

const failure = (reason: CouponFailure, shortfallPaisa: number | null = null): CouponEvaluation => ({
  ok: false,
  reason,
  shortfallPaisa,
});

/**
 * কুপন এই অর্ডারে খাটবে কি না।
 *
 * শর্তগুলো ক্রমে দেখা হয় আর **প্রথম ব্যর্থতাতেই** থামা হয়, কারণ
 * ক্রেতাকে একবারে একটা কাজ বলা উচিত — "আগে কুপন চালু করান, তারপর
 * আরো ৩০০ টাকার কিনুন" বলার কোনো মানে নেই।
 *
 * **ব্যবহারের সংখ্যা এখানে ইনপুট হিসেবে নেওয়া হয়, গোনা হয় না** —
 * গোনাটা DB-র কাজ আর সেটা অবশ্যই অর্ডারের transaction-এর ভেতরে
 * হতে হবে, নইলে দুটো চেকআউট একই শেষ কুপন পেয়ে যেত।
 */
export const evaluateCoupon = (coupon: CouponLike, context: CouponContext): CouponEvaluation => {
  if (!coupon.isActive) {
    return failure(COUPON_FAILURE.INACTIVE);
  }

  // সীমানার মুহূর্তটা ক্রেতার পক্ষে — "শেষ দিন" সত্যিই শেষ দিন
  if (coupon.startsAt !== null && context.now.getTime() < coupon.startsAt.getTime()) {
    return failure(COUPON_FAILURE.NOT_STARTED);
  }

  if (coupon.endsAt !== null && context.now.getTime() > coupon.endsAt.getTime()) {
    return failure(COUPON_FAILURE.EXPIRED);
  }

  if (context.subtotalPaisa < coupon.minOrderPaisa) {
    return failure(COUPON_FAILURE.BELOW_MINIMUM, coupon.minOrderPaisa - context.subtotalPaisa);
  }

  if (coupon.maxUses !== null && context.totalUses >= coupon.maxUses) {
    return failure(COUPON_FAILURE.EXHAUSTED);
  }

  /**
   * প্রতি-ক্রেতা সীমা।
   *
   * `null` হলে কোনো সীমাই নেই — কিছু গোনার দরকার নেই, তাই গেস্টও
   * এই কুপন পায়।
   *
   * সীমা থাকলে গুনতে হয়, আর গুনতে `userId` লাগে। গেস্টের বেলায়
   * `userUses` `null` আসে, মানে গোনার উপায় নেই — তখন কুপনটা দেওয়া
   * হয় না। চুপচাপ সীমাটা উপেক্ষা করলে একজনই incognito খুলে পুরো
   * ক্যাম্পেইন নিয়ে নিত।
   *
   * এটাই একমাত্র জায়গা যেখানে গেস্ট আর সদস্যের আচরণ আলাদা।
   */
  if (coupon.maxUsesPerUser !== null) {
    if (context.userUses === null) {
      return failure(COUPON_FAILURE.LOGIN_REQUIRED);
    }

    if (context.userUses >= coupon.maxUsesPerUser) {
      return failure(COUPON_FAILURE.ALREADY_USED);
    }
  }

  return { ok: true, coupon };
};
