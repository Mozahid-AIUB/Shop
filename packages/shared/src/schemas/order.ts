import { z } from 'zod';
import { phoneSchema } from './auth';
import { ORDER_STATUSES, PAYMENT_STATUSES } from '../constants/order';
import { ORDER_NUMBER_REGEX } from '../constants/order-number';

/**
 * Cart, address আর checkout-এর validation — API-তে input যাচাই,
 * web-এ চেকআউট ফর্ম। নিয়ম একবার লেখা হয়, দুই পাশে মেলে।
 *
 * লক্ষ করো: **কোনো schema-তে দাম নেই**। দাম সবসময় সার্ভারে DB থেকে
 * পড়া হয়। ক্লায়েন্টকে দাম পাঠাতে দিলে যে কেউ ১ টাকায় ফোন কিনে ফেলত।
 */

/**
 * এক আইটেমের পরিমাণ। উপরে সীমা আছে কারণ খুচরো দোকানে একবারে
 * ১০০-র বেশি একই variant কেউ কেনে না — ওটা হয় ভুল টাইপ, নয় abuse।
 */
export const quantitySchema = z
  .number()
  .int('পরিমাণ পূর্ণসংখ্যা হতে হবে')
  .min(1, 'পরিমাণ অন্তত ১')
  .max(100, 'একবারে সর্বোচ্চ ১০০টা');

// ---------- Cart ----------

export const addCartItemSchema = z.object({
  variantId: z.string().cuid('পণ্য বাছুন'),
  quantity: quantitySchema,
});

export const updateCartItemSchema = z.object({
  quantity: quantitySchema,
});

// ---------- Address ----------

/**
 * ঠিকানা। জেলা free text রাখা হয়েছে — enum করলে নতুন
 * উপজেলা/এলাকা যোগ করতে প্রতিবার deploy লাগত।
 */
export const createAddressSchema = z.object({
  /** "বাসা", "অফিস" — ইউজারের নিজের চেনার জন্য */
  label: z.string().trim().max(30).nullable().optional(),
  fullName: z.string().trim().min(2, 'নাম অন্তত ২ অক্ষর').max(60, 'নাম অনেক বড়'),
  /** COD-এ কুরিয়ার এই নম্বরে ফোন করে — তাই বাংলাদেশি নম্বরই লাগবে */
  phone: phoneSchema,
  line1: z.string().trim().min(5, 'ঠিকানা অন্তত ৫ অক্ষর').max(200, 'ঠিকানা অনেক বড়'),
  line2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(2, 'শহর/থানা দিন').max(60),
  district: z.string().trim().min(2, 'জেলা দিন').max(60),
  postcode: z.string().trim().regex(/^\d{4}$/, 'পোস্টকোড ৪ সংখ্যার').nullable().optional(),
  /** প্রথম ঠিকানা এমনিতেই default হবে — service সেটা দেখবে */
  isDefault: z.boolean().optional(),
});

export const updateAddressSchema = createAddressSchema.partial();

// ---------- Checkout ----------

/**
 * চেকআউট। আইটেম এখানে পাঠানো হয় না — কার্ট সার্ভারেই আছে,
 * সেখান থেকেই পড়া হবে। ক্লায়েন্টের পাঠানো তালিকা নিলে কার্টে না থাকা
 * পণ্যও অর্ডারে ঢুকিয়ে দেওয়া যেত।
 */
export const checkoutSchema = z.object({
  /**
   * সংরক্ষিত ঠিকানা বাছা, **নয়তো** নতুন ঠিকানা লেখা — একটাই লাগবে।
   * দুটোই দিলে কোনটা মানবে তা অস্পষ্ট, তাই নিচে refine-এ আটকানো।
   */
  addressId: z.string().cuid().optional(),
  address: createAddressSchema.optional(),
  note: z.string().trim().max(500, 'নোট অনেক বড়').nullable().optional(),

  /**
   * কুপন কোড — **শুধু কোড, ছাড়ের অঙ্ক নয়**।
   *
   * ছাড় কখনো ক্লায়েন্ট থেকে নেওয়া হয় না। `discountPaisa` ইনপুটে
   * নিলে যে কেউ ব্রাউজার থেকে নিজের ছাড় নিজে ঠিক করত। সার্ভার
   * কোড দেখে DB-র নিয়ম অনুযায়ী নিজে হিসাব করে।
   */
  couponCode: z.string().trim().min(3).max(32).optional(),
});

export const checkoutInputSchema = checkoutSchema.refine(
  (value) => (value.addressId === undefined) !== (value.address === undefined),
  { message: 'ঠিকানা বাছুন বা নতুন ঠিকানা দিন — একটা', path: ['addressId'] },
);

// ---------- Status change (staff) ----------

export const changeOrderStatusSchema = z.object({
  toStatus: z.enum(ORDER_STATUSES),
  /** কেন বদলালো — বাতিলে বিশেষভাবে দরকারি */
  note: z.string().trim().max(300).nullable().optional(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3, 'বাতিলের কারণ লিখুন').max(300),
});

// ---------- Public tracking ----------

/**
 * লগইন ছাড়া অর্ডার খোঁজা — **দুটোই** মিলতে হবে।
 *
 * শুধু Order ID দিলে যে কেউ `001` থেকে গুনে সব অর্ডার দেখে ফেলত:
 * কে কী কিনেছে, কোথায় থাকে। ফোন মেলানো মানে অর্ডারটা যার সে-ই দেখছে।
 */
export const trackOrderSchema = z.object({
  orderNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(ORDER_NUMBER_REGEX, 'অর্ডার নম্বর এভাবে হবে: ORD-2026-1123-018'),
  phone: phoneSchema,
});

// ---------- Admin order board ----------

export const orderListQuerySchema = z.object({
  /** orderNumber, ফোন বা নামের অংশ */
  search: z.string().trim().max(80).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  /** ISO তারিখ — এই দিন থেকে (সার্ভারের লোকাল দিন ধরে) */
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'তারিখ YYYY-MM-DD').optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'তারিখ YYYY-MM-DD').optional(),
  page: z.coerce.number().int().min(1).default(1),
  /** উপরে সীমা — নইলে `perPage=100000` দিয়ে পুরো DB টেনে নেওয়া যেত */
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export type ChangeOrderStatusInput = z.infer<typeof changeOrderStatusSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type TrackOrderInput = z.infer<typeof trackOrderSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
export type CheckoutInput = z.infer<typeof checkoutInputSchema>;
