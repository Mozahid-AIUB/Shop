import type { ThrottlerOptions } from '@nestjs/throttler';

/**
 * Rate limit-এর সীমা।
 *
 * **কেন env দিয়ে নিয়ন্ত্রণযোগ্য:** auth-security টেস্টে ইচ্ছাকৃতভাবে
 * বারবার ভুল পাসওয়ার্ড পাঠানো হয় (timing attack, reuse detection) —
 * সেটাই ঠিক যা throttle আটকায়। সীমা স্থির করে দিলে হয় টেস্ট ভাঙত,
 * নয় সীমা এত ঢিলে রাখতে হতো যে production-এ অর্থহীন হয়ে যেত।
 *
 * টেস্টে `THROTTLE_DISABLED=true` দিলে সীমা কার্যত তুলে নেওয়া হয়;
 * rate limit নিজের টেস্ট এটা না দিয়ে চলে, তাই সুরক্ষাটা যাচাই হয়।
 */

/** সীমা তুলে নেওয়া হলে এই অঙ্ক — কোনো বাস্তব টেস্ট এতদূর যায় না। */
const UNLIMITED = 100_000;

/**
 * `limit` একটা **ফাংশন** হিসেবে দেওয়া হয়, স্থির সংখ্যা নয়।
 *
 * `ThrottlerModule.forRoot()` module import-এর সময়ই একবার চলে, তাই
 * স্থির সংখ্যা দিলে env পরে বদলালেও কিছু হতো না — টেস্টে
 * `THROTTLE_DISABLED` মুছে দিলেও পুরোনো সীমাই বসে থাকত।
 * ফাংশন দিলে প্রতিটা request-এ তাজা মান পড়া হয়।
 */
const limit =
  (value: number) =>
  (): number =>
    process.env.THROTTLE_DISABLED === 'true' ? UNLIMITED : value;

/** নামগুলো `@Throttle()`-এ ব্যবহার হয়, তাই এক জায়গায় রাখা। */
export const THROTTLE_SHORT = 'short';
export const THROTTLE_LOGIN = 'login';
export const THROTTLE_REGISTER = 'register';
export const THROTTLE_TRACK = 'track';
export const THROTTLE_COUPON = 'coupon';

/**
 * `@SkipThrottle()` নাম ধরে কাজ করে — খালি ডাকলে শুধু `default`
 * নামের throttler বাদ পড়ে, আর আমাদের কোনোটার নামই `default` নয়।
 * তাই প্রতিটা নাম স্পষ্ট করে বলতে হয়, নইলে skip নীরবে কিছুই করে না।
 */
export const SKIP_ALL_THROTTLERS: Record<string, boolean> = {
  [THROTTLE_SHORT]: true,
  [THROTTLE_LOGIN]: true,
  [THROTTLE_REGISTER]: true,
  [THROTTLE_TRACK]: true,
  [THROTTLE_COUPON]: true,
};

/**
 * গ্লোবাল সীমা — মিনিটে ১০০। সাধারণ ব্রাউজিং এতে আটকায় না,
 * কিন্তু স্ক্রিপ্ট দিয়ে হাজারবার ডাকা বন্ধ হয়।
 *
 * নামওয়ালা বাকি তিনটা নির্দিষ্ট route-এ `@Throttle()` দিয়ে বসে।
 * গ্লোবাল guard থাকায় নতুন endpoint যোগ করলে সেটাও ডিফল্টে
 * সুরক্ষিত — ভুলে যাওয়ার সুযোগ নেই।
 */
export const throttlerConfig = (): ThrottlerOptions[] => [
  {
    name: THROTTLE_SHORT,
    ttl: 60_000,
    limit: limit(100),
  },
  {
    /** পাসওয়ার্ড অনুমান করা অসম্ভব করে তোলে */
    name: THROTTLE_LOGIN,
    ttl: 60_000,
    limit: limit(5),
  },
  {
    /** ভুয়া অ্যাকাউন্টের বান ঠেকায় — ঘণ্টায় ১০ */
    name: THROTTLE_REGISTER,
    ttl: 3_600_000,
    limit: limit(10),
  },
  {
    /**
     * `/track` লগইন ছাড়া খোলা আর Order ID অনুমানযোগ্য
     * (তারিখ + সিরিয়াল)। মিনিটে ১০ রাখলে ০০১ থেকে গুনে সব অর্ডার
     * বের করা অকেজো হয়ে যায়, অথচ আসল কাস্টমারের কষ্ট হয় না।
     */
    name: THROTTLE_TRACK,
    ttl: 60_000,
    limit: limit(10),
  },
  {
    /**
     * কুপন কোড যাচাই। কোড ছোট আর অনুমানযোগ্য ("SAVE50", "EID10"),
     * তাই সীমা না থাকলে স্ক্রিপ্ট চালিয়ে কাজের কুপন খুঁজে বের করা
     * যেত — আর প্রতিটা চেষ্টায় DB-তে গোনার query চলত।
     *
     * মিনিটে ১০: আসল ক্রেতা দুয়েকটা কোড চেষ্টা করে, হাজারটা নয়।
     */
    name: THROTTLE_COUPON,
    ttl: 60_000,
    limit: limit(10),
  },
];
