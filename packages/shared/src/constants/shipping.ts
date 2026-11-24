/**
 * শিপিং চার্জের হিসাব।
 *
 * **কেন নিয়মটা এখানে, api-তে নয়:** কার্টের পাতায় ক্রেতাকে
 * "ডেলিভারি চার্জ ৬০ টাকা" দেখাতে হবে চেকআউটের আগেই। দুই জায়গায়
 * দুই নিয়ম লিখলে কার্টে এক আর অর্ডারে আরেক অঙ্ক দেখাতো — ক্রেতার
 * বিশ্বাস নষ্ট হওয়ার সবচেয়ে সহজ উপায়।
 *
 * **চার্জ অর্ডারে কপি হয়ে যায়** (`Order.shippingPaisa`)। পরে
 * চার্জ বাড়ালে পুরোনো ইনভয়েসের অঙ্ক বদলানো চলবে না।
 */

/** zone মেলানোর জন্য দরকারি অংশটুকু। */
export type ShippingZoneLike = {
  id: string;
  name: string;
  /** কোন জেলাগুলো এই zone-এ */
  districts: readonly string[];
  chargePaisa: number;
  /** এই অঙ্কের সমান বা বেশি হলে ফ্রি। `null` মানে কখনো ফ্রি নয় */
  freeAbovePaisa: number | null;
  isDefault: boolean;
};

export type ShippingQuote = {
  zoneId: string;
  zoneName: string;
  chargePaisa: number;
  /** ফ্রি হলো কিনা — কার্টে "ফ্রি ডেলিভারি!" দেখানোর জন্য */
  isFree: boolean;
  /** আর কত টাকার কিনলে ফ্রি হতো। ফ্রি হয়ে গেলে বা সুযোগ না থাকলে `null` */
  freeAfterPaisa: number | null;
};

/**
 * জেলার নাম তুলনার জন্য সাজানো।
 *
 * জেলা free text (enum করলে নতুন এলাকা যোগ করতে deploy লাগত), তাই
 * "Dhaka", "dhaka", " DHAKA " — সব একই জেলা ধরা হয়। না করলে
 * ক্রেতা ছোট হাতে লিখলে default zone-এর বেশি চার্জ পড়ত।
 */
export const normalizeDistrict = (value: string): string => value.trim().toLowerCase();

/**
 * জেলা অনুযায়ী zone খোঁজা।
 *
 * না মিললে `isDefault` zone। **default সবসময় থাকতে হবে** — নইলে
 * নতুন কোনো জেলার ক্রেতা শূন্য চার্জে ডেলিভারি পেয়ে যেত, যা
 * প্রতিটা অর্ডারে সরাসরি লোকসান।
 */
export const findZoneForDistrict = <T extends ShippingZoneLike>(
  zones: readonly T[],
  district: string,
): T | null => {
  const target = normalizeDistrict(district);

  const matched = zones.find((zone) =>
    zone.districts.some((name) => normalizeDistrict(name) === target),
  );

  if (matched !== undefined) {
    return matched;
  }

  return zones.find((zone) => zone.isDefault) ?? null;
};

/**
 * চার্জের হিসাব।
 *
 * `subtotalPaisa` ধরা হয় **ছাড়ের আগের** অঙ্ক। কুপনের ছাড় বাদ দিয়ে
 * গুনলে ক্রেতা ছাড় নিয়ে ফ্রি ডেলিভারির সীমার নিচে নেমে যেত আর
 * হঠাৎ চার্জ ফিরে আসত — দেখতে ভাঙা মনে হয়।
 */
export const quoteShipping = (
  zone: ShippingZoneLike,
  subtotalPaisa: number,
): ShippingQuote => {
  const threshold = zone.freeAbovePaisa;
  const qualifiesFree = threshold !== null && subtotalPaisa >= threshold;

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    chargePaisa: qualifiesFree ? 0 : zone.chargePaisa,
    isFree: qualifiesFree,
    // "আর ২০০ টাকার কিনলে ডেলিভারি ফ্রি" — বিক্রি বাড়ানোর সহজ উপায়
    freeAfterPaisa:
      threshold === null || qualifiesFree ? null : threshold - subtotalPaisa,
  };
};
