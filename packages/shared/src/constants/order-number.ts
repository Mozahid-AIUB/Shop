/**
 * অর্ডার নম্বরের ফরম্যাট — `ORD-2026-1123-018`।
 *
 * কেন এই আকার: ফোনে পড়ে শোনানো সহজ ("ORD, ছাব্বিশ, এগারো তেইশ, আঠারো"),
 * আর তারিখ ভেতরেই থাকায় সাপোর্ট নম্বর দেখেই বুঝে যায় অর্ডারটা কোন দিনের।
 *
 * সিরিয়াল **রোজ ০০১ থেকে** শুরু — দিনের চাবি (`dateKey`) আর সিরিয়াল মিলে
 * নম্বর অদ্বিতীয় হয়। সিরিয়াল কোথা থেকে আসে সেটা এখানে নয়, API-র
 * `OrderNumberService`-এ (কাউন্টার টেবিল + লক)।
 */

const ORDER_NUMBER_PREFIX = 'ORD';

/** `ORD-2026-1123-018` — সিরিয়াল ৩ অঙ্কের বেশি হলে তত অঙ্কই থাকবে। */
export const ORDER_NUMBER_REGEX = /^ORD-(\d{4})-(\d{4})-(\d{3,})$/;

/** `new Date()` থেকে দিনের চাবি — `"2026-1123"`। */
export function orderDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}${day}`;
}

/**
 * দিনের চাবি + সিরিয়াল → পূর্ণ অর্ডার নম্বর।
 *
 * সিরিয়াল ৯৯৯ ছাড়ালে নম্বর চার অঙ্কে যায়, **কাটা হয় না** — কাটলে
 * দুটো অর্ডার একই নম্বর পেত আর `orderNumber` unique হওয়ায় চেকআউট ব্যর্থ হতো।
 */
export function formatOrderNumber(date: Date, serial: number): string {
  if (!Number.isInteger(serial) || serial < 1) {
    throw new Error(`Order serial must be a positive integer, got ${serial}`);
  }

  return `${ORDER_NUMBER_PREFIX}-${orderDateKey(date)}-${String(serial).padStart(3, '0')}`;
}

/**
 * নম্বর থেকে তারিখের চাবি আর সিরিয়াল ফেরত। ফরম্যাট না মিললে `null` —
 * throw নয়, কারণ এটা ইউজারের টাইপ করা ইনপুটেও চলে (সাপোর্টের অর্ডার খোঁজা)।
 */
export function parseOrderNumber(value: string): { dateKey: string; serial: number } | null {
  const match = ORDER_NUMBER_REGEX.exec(value);

  if (!match) {
    return null;
  }

  const [, year, monthDay, serial] = match;

  // regex মিললে তিনটে group-ই থাকে; noUncheckedIndexedAccess-কে বোঝানোর জন্য
  if (year === undefined || monthDay === undefined || serial === undefined) {
    return null;
  }

  return {
    dateKey: `${year}-${monthDay}`,
    serial: Number(serial),
  };
}
