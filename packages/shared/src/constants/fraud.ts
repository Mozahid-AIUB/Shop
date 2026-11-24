/**
 * COD ঝুঁকির স্কোর।
 *
 * **কেন দরকার:** কাস্টম টি-শার্টে ক্ষতিটা দ্বিগুণ। ছাপা হয়ে গেলে পণ্য
 * আর কাউকে বেচা যায় না (ডিজাইন ওই কাস্টমারের), আর কুরিয়ারের
 * যাওয়া-আসার খরচও যায়।
 *
 * **কেন ব্লক করা হয় না — এটাই এখানকার মূল নিয়ম:**
 *
 * দুই রকম ভুল হতে পারে, কিন্তু দামে তারা সমান নয়।
 * - জালিয়াতকে ছেড়ে দিলে এক অর্ডারের পণ্য আর কুরিয়ার খরচ যায়।
 *   ক্ষতিটা মাপা যায়, আর চোখে পড়ে।
 * - আসল ক্রেতাকে আটকে দিলে সে চিরতরে চলে যায়, বন্ধুদের বলে, আর
 *   **তুমি কোনোদিন জানতেও পারো না** — ব্লক হওয়া ক্রেতা অভিযোগ করতে
 *   আসে না, চুপচাপ অন্য দোকানে চলে যায়।
 *
 * দ্বিতীয় ক্ষতিটা অদৃশ্য ও স্থায়ী। তাই এই কোড কখনো "না" বলে না,
 * শুধু বলে "এটা একটু দেখে নিন"। সিদ্ধান্ত মানুষের।
 */

export const FRAUD_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;

export type FraudLevel = (typeof FRAUD_LEVELS)[number];

/** স্তরের সীমানা — এর উপরে গেলে ওই স্তর। */
export const FRAUD_MEDIUM_THRESHOLD = 25;
export const FRAUD_HIGH_THRESHOLD = 50;

/** স্কোর এই সীমার বাইরে যায় না — ০-১০০ পড়তে সহজ। */
export const FRAUD_MIN_SCORE = 0;
export const FRAUD_MAX_SCORE = 100;

/**
 * প্রতিটা সংকেতের ওজন।
 *
 * সংখ্যাগুলো আন্দাজ, নিখুঁত নয় — আসল ডেটা জমলে বদলাতে হবে। তাই
 * এক জায়গায় রাখা, কোডের ভেতরে ছড়িয়ে নয়।
 */
export const FRAUD_WEIGHTS = {
  /** আগের প্রতিটা বাতিল/ফেরত অর্ডার। **সবচেয়ে বিশ্বস্ত সংকেত** */
  perFailedOrder: 25,
  /** বাতিলের জন্য সর্বোচ্চ — একটা সংকেতই পুরো স্কোর দখল করবে না */
  failedOrderCap: 50,
  /** একই ফোনে ২৪ ঘণ্টায় অনেক অর্ডার */
  rapidOrders: 20,
  /** নতুন অ্যাকাউন্ট + বড় অঙ্কের COD — সবচেয়ে বেশি ক্ষতি এখানে */
  newAccountLargeOrder: 20,
  /** একই ঠিকানা, আলাদা অ্যাকাউন্ট — ব্লক এড়ানোর চিহ্ন */
  sharedAddress: 15,
  /** প্রতিটা সফল ডেলিভারি স্কোর **কমায়** */
  perSuccessfulOrder: -15,
  /** সফল অর্ডারের জন্য সর্বোচ্চ ছাড় */
  successfulOrderCap: -45,
} as const;

/** কত সময়ের ভেতর বারবার অর্ডারকে "দ্রুত" ধরা হবে। */
export const FRAUD_RAPID_WINDOW_HOURS = 24;

/** এতগুলোর বেশি হলে দ্রুত অর্ডার ধরা হবে। */
export const FRAUD_RAPID_ORDER_COUNT = 3;

/** এর কম বয়সী অ্যাকাউন্ট "নতুন"। */
export const FRAUD_NEW_ACCOUNT_DAYS = 7;

/**
 * স্কোরের কারণ — অ্যাডমিন যেন **কেন** সেটা দেখতে পায়।
 *
 * শুধু "৬৫" দেখালে কেউ কিছু করতে পারে না। "আগে ২টা অর্ডার ফেরত
 * দিয়েছে" দেখলে সে জানে ফোনে কী জিজ্ঞেস করতে হবে। ব্যাখ্যাহীন
 * স্কোর মানুষ হয় অন্ধভাবে মানে, নয় একেবারে উপেক্ষা করে।
 */
export type FraudReason = {
  code: 'FAILED_ORDERS' | 'RAPID_ORDERS' | 'NEW_ACCOUNT_LARGE_ORDER' | 'SHARED_ADDRESS' | 'GOOD_HISTORY';
  points: number;
  /** বাংলায় পড়ার মতো ব্যাখ্যা — সরাসরি প্যানেলে দেখানো যায় */
  detail: string;
};

/** স্কোর বের করতে যা যা জানা দরকার। */
export type FraudSignals = {
  /** আগে বাতিল/ফেরত হওয়া অর্ডারের সংখ্যা */
  failedOrders: number;
  /** সফলভাবে ডেলিভারি হওয়া অর্ডারের সংখ্যা */
  successfulOrders: number;
  /** গত ২৪ ঘণ্টায় এই ফোনে কতগুলো অর্ডার (এটা সহ) */
  recentOrderCount: number;
  /** অ্যাকাউন্টের বয়স, দিনে */
  accountAgeDays: number;
  /** এই অর্ডারের মোট, paisa-তে */
  orderTotalPaisa: number;
  /** "বড় অর্ডার" কত থেকে — `.env` দিয়ে বদলানো যায় */
  largeOrderPaisa: number;
  /** একই ঠিকানা অন্য কোনো অ্যাকাউন্টও ব্যবহার করেছে কিনা */
  addressUsedByOthers: boolean;
};

export type FraudAssessment = {
  score: number;
  level: FraudLevel;
  reasons: FraudReason[];
};

/** স্কোর থেকে স্তর। */
export const fraudLevelFor = (score: number): FraudLevel => {
  if (score >= FRAUD_HIGH_THRESHOLD) {
    return 'HIGH';
  }

  if (score >= FRAUD_MEDIUM_THRESHOLD) {
    return 'MEDIUM';
  }

  return 'LOW';
};

/**
 * সংকেত থেকে স্কোর।
 *
 * বিশুদ্ধ ফাংশন — DB ছাড়াই টেস্ট করা যায়, আর পরে UI-তেও একই নিয়ম
 * দেখানো যাবে। দুই জায়গায় দুই নিয়ম লিখলে তারা আলাদা হয়ে যেত।
 */
export const assessFraud = (signals: FraudSignals): FraudAssessment => {
  const reasons: FraudReason[] = [];
  let score = 0;

  if (signals.failedOrders > 0) {
    const points = Math.min(
      signals.failedOrders * FRAUD_WEIGHTS.perFailedOrder,
      FRAUD_WEIGHTS.failedOrderCap,
    );

    score += points;
    reasons.push({
      code: 'FAILED_ORDERS',
      points,
      detail: `আগে ${signals.failedOrders}টা অর্ডার বাতিল বা ফেরত হয়েছে`,
    });
  }

  if (signals.recentOrderCount > FRAUD_RAPID_ORDER_COUNT) {
    score += FRAUD_WEIGHTS.rapidOrders;
    reasons.push({
      code: 'RAPID_ORDERS',
      points: FRAUD_WEIGHTS.rapidOrders,
      detail: `গত ${FRAUD_RAPID_WINDOW_HOURS} ঘণ্টায় ${signals.recentOrderCount}টা অর্ডার`,
    });
  }

  /**
   * নতুন অ্যাকাউন্ট **একা** সন্দেহের কারণ নয় — সব ক্রেতাই একদিন
   * নতুন ছিল। বড় অঙ্কের সাথে মিললে তবেই ঝুঁকি।
   */
  if (
    signals.accountAgeDays < FRAUD_NEW_ACCOUNT_DAYS &&
    signals.orderTotalPaisa >= signals.largeOrderPaisa
  ) {
    score += FRAUD_WEIGHTS.newAccountLargeOrder;
    reasons.push({
      code: 'NEW_ACCOUNT_LARGE_ORDER',
      points: FRAUD_WEIGHTS.newAccountLargeOrder,
      detail: `অ্যাকাউন্ট ${signals.accountAgeDays} দিনের, আর অর্ডারটা বড় অঙ্কের`,
    });
  }

  if (signals.addressUsedByOthers) {
    score += FRAUD_WEIGHTS.sharedAddress;
    reasons.push({
      code: 'SHARED_ADDRESS',
      points: FRAUD_WEIGHTS.sharedAddress,
      detail: 'এই ঠিকানা অন্য অ্যাকাউন্টও ব্যবহার করেছে',
    });
  }

  /**
   * ভালো ইতিহাস স্কোর কমায়। না রাখলে বহু বছরের বিশ্বস্ত ক্রেতা
   * একবার অর্ডার বাতিল করলেই চিরকাল সন্দেহভাজন থেকে যেত।
   */
  if (signals.successfulOrders > 0) {
    const points = Math.max(
      signals.successfulOrders * FRAUD_WEIGHTS.perSuccessfulOrder,
      FRAUD_WEIGHTS.successfulOrderCap,
    );

    score += points;
    reasons.push({
      code: 'GOOD_HISTORY',
      points,
      detail: `${signals.successfulOrders}টা অর্ডার সফলভাবে নিয়েছে`,
    });
  }

  const bounded = Math.min(Math.max(score, FRAUD_MIN_SCORE), FRAUD_MAX_SCORE);

  return { score: bounded, level: fraudLevelFor(bounded), reasons };
};
