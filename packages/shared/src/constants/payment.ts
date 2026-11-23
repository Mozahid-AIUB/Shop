/**
 * পেমেন্টের ধরন ও অবস্থা — Prisma enum-এর সাথে **হুবহু** মিল থাকতে হবে,
 * নইলে একদিকে যোগ করে অন্যদিকে ভুলে গেলে runtime-এ ধরা পড়বে।
 */

/**
 * `*_MANUAL` মানে গেটওয়ে নয় — কাস্টমার টাকা পাঠিয়েছে, অ্যাডমিন
 * হাতে লিখেছে। Phase 05-এ গেটওয়ে নেই, তাই সবই হাতে বা COD।
 */
export const PAYMENT_METHODS = [
  'COD',
  'BKASH_MANUAL',
  'NAGAD_MANUAL',
  'BANK_TRANSFER',
  'CASH',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** বাংলায় দেখানোর নাম — UI-তে enum সরাসরি দেখাবে না। */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  COD: 'ক্যাশ অন ডেলিভারি',
  BKASH_MANUAL: 'বিকাশ',
  NAGAD_MANUAL: 'নগদ',
  BANK_TRANSFER: 'ব্যাংক ট্রান্সফার',
  CASH: 'নগদ টাকা',
};

/**
 * ভুল এন্ট্রি মুছে ফেলা হয় না — `VOIDED` করা হয়। টাকার হিসাবে
 * row মুছলে অডিটে "কেন যোগফল মিলছে না" প্রশ্নের উত্তর থাকে না।
 */
export const PAYMENT_RECORD_STATUSES = ['RECEIVED', 'VOIDED', 'REFUNDED'] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

/**
 * যে method-এ `reference` (TrxID / slip নম্বর) **লাগবেই**।
 * COD-এ কুরিয়ার টাকা আনে, কোনো TrxID থাকে না — তাই ওটা বাদ।
 */
export const METHODS_REQUIRING_REFERENCE: readonly PaymentMethod[] = [
  'BKASH_MANUAL',
  'NAGAD_MANUAL',
  'BANK_TRANSFER',
];

export const requiresReference = (method: PaymentMethod): boolean =>
  METHODS_REQUIRING_REFERENCE.includes(method);
