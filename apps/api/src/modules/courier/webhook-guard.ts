import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * webhook যাচাইয়ের সরঞ্জাম — **সব adapter এটাই ব্যবহার করে**।
 *
 * **কেন এক জায়গায়:** প্রত্যেক কুরিয়ার আলাদাভাবে signature পাঠায়
 * (কেউ HMAC header, কেউ body-তে token), কিন্তু **তুলনা করার
 * নিয়মটা** একই হতে হবে। প্রতিটা adapter নিজে লিখলে কোথাও একটা
 * `===` বসে যেত, আর সেই একটা জায়গা দিয়েই ভুয়া webhook ঢুকত।
 *
 * **ভুয়া webhook-এর দাম:** যে কেউ "DELIVERED" পাঠিয়ে অর্ডার
 * ডেলিভারড দেখাত, আর COD-র টাকা না পেয়েই হিসাব মিলে যেত। ভুয়া
 * রিটার্নও পাঠানো যেত, যা ক্রেতার ঝুঁকির স্কোর নষ্ট করত।
 */

/**
 * গোপন মান মেলানো — **সময়-নিরপেক্ষভাবে**।
 *
 * সাধারণ `===` প্রথম অমিল অক্ষরেই থেমে যায়, তাই উত্তর আসার সময়
 * মেপে অক্ষর ধরে ধরে secret অনুমান করা যায়। `timingSafeEqual`
 * সবসময় পুরোটা মেলায়।
 *
 * দৈর্ঘ্য আলাদা হলে আগেই `false` — `timingSafeEqual` আলাদা
 * দৈর্ঘ্যে throw করে, আর দৈর্ঘ্য ফাঁস হওয়া বিপজ্জনক নয়।
 */
export const secretMatches = (given: string | undefined, expected: string): boolean => {
  if (given === undefined) {
    return false;
  }

  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * HMAC signature মেলানো।
 *
 * কুরিয়ার body-টা secret দিয়ে sign করে header-এ পাঠায়। আমরা
 * একইভাবে গুনে মিলিয়ে দেখি — মিললে body-টা সত্যিই তাদের, আর
 * পথে কেউ বদলায়নি।
 *
 * **কাঁচা body লাগে, parse করা object নয়** — JSON আবার
 * stringify করলে মাঠের ক্রম বা ফাঁকা জায়গা বদলে যেতে পারে, আর
 * তখন signature মিলত না যদিও webhook আসল।
 */
export const hmacMatches = (
  rawBody: string,
  signature: string | undefined,
  secret: string,
  algorithm = 'sha256',
): boolean => {
  if (signature === undefined) {
    return false;
  }

  const expected = createHmac(algorithm, secret).update(rawBody, 'utf8').digest('hex');

  return secretMatches(signature.toLowerCase(), expected);
};

/** header-এর মান — একই নাম দুবার এলে প্রথমটা। */
export const headerValue = (
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined => {
  const value = headers[name.toLowerCase()];

  return Array.isArray(value) ? value[0] : value;
};

/**
 * কুরিয়ারের অবস্থার নাম আমাদের নামে অনুবাদ।
 *
 * **কেন একটা map, `if` নয়:** প্রত্যেক কুরিয়ারের শব্দ আলাদা
 * ("delivered", "Delivered", "DELIVERED_TO_CUSTOMER", "সম্পন্ন"),
 * আর নতুন শব্দ যোগ হয় বিজ্ঞপ্তি ছাড়াই। map-এ থাকলে একটা লাইন
 * যোগ করলেই চলে।
 *
 * **অজানা শব্দে `null`** — অনুমান করে `DELIVERED` ধরে নিলে টাকা
 * না পেয়েই অর্ডার সম্পন্ন দেখাত। অজানা থাকলে পার্সেল যেমন ছিল
 * তেমনই থাকে, আর `rawStatus`-এ কাঁচা মান জমা হয় যাতে অ্যাডমিন
 * দেখে বুঝতে পারে নতুন কী এসেছে।
 */
export const mapStatus = <T>(
  raw: string | undefined,
  table: Record<string, T>,
): T | null => {
  if (raw === undefined) {
    return null;
  }

  return table[raw.trim().toLowerCase()] ?? null;
};
