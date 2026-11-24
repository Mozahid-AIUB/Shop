import { z } from 'zod';
import { paisaSchema } from './catalog';

/**
 * ডেলিভারি চার্জের এলাকা — অ্যাডমিন প্যানেল থেকে বদলানো যায়।
 *
 * **কিছু হার্ডকোড নয়:** চার্জ, এলাকা, ফ্রি ডেলিভারির সীমা — সব
 * অ্যাডমিন ঠিক করে। এই কোড অন্য ব্যবসায়ীদের কাছে বিক্রি হবে,
 * তাদের হার ও এলাকা আলাদা হবে।
 */

/** জেলার নাম। free text, কারণ enum করলে নতুন এলাকায় deploy লাগত। */
const districtNameSchema = z.string().trim().min(2, 'জেলার নাম দিন').max(60);

export const shippingZoneInputSchema = z.object({
  name: z.string().trim().min(2, 'এলাকার নাম দিন').max(60),

  /**
   * কোন জেলাগুলো এই zone-এ। **খালি রাখা যায়** — তখন এটা শুধু
   * default zone হিসেবেই কাজ করে ("যা কিছু উপরে মেলেনি")।
   */
  districts: z.array(districtNameSchema).max(64, 'জেলা ৬৪টার বেশি নয়').default([]),

  chargePaisa: paisaSchema,

  /**
   * এই অঙ্কের সমান বা বেশি হলে ফ্রি।
   *
   * `null` দিলে **এই এলাকায় কখনো ফ্রি নয়** — ঢাকার বাইরে কুরিয়ার
   * খরচ বেশি, তাই অনেক দোকান সেখানে ফ্রি দেয় না।
   */
  freeAbovePaisa: paisaSchema.nullable().default(null),

  /**
   * কোনো জেলা না মিললে এই zone।
   *
   * **ঠিক একটা zone-এ `true` থাকতে হবে।** না থাকলে অচেনা জেলার
   * ক্রেতার চার্জ বের করা যায় না; service তখন ভেঙে পড়ে, যাতে
   * ভুলটা চোখে পড়ে — চুপচাপ ফ্রি ডেলিভারি দেওয়ার চেয়ে ভালো।
   */
  isDefault: z.boolean().default(false),

  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

/**
 * আপডেট — যা পাঠানো হয়নি তা **অপরিবর্তিত** থাকবে।
 *
 * **`shippingZoneInputSchema.partial()` ব্যবহার করা যায় না।** `.partial()`
 * মাঠগুলো ঐচ্ছিক করে, কিন্তু `.default()` সরায় না — তাই শুধু
 * `{ chargePaisa }` পাঠালেও Zod বাকি সব মাঠে default বসিয়ে দিত:
 * জেলার তালিকা `[]` হয়ে মুছে যেত, `isDefault` false হয়ে যেত।
 * অর্থাৎ চার্জ বদলাতে গিয়ে অ্যাডমিন অজান্তে পুরো zone ভেঙে ফেলত।
 *
 * তাই প্রতিটা মাঠ এখানে আলাদা করে লেখা, কোনো default ছাড়া।
 */
export const shippingZoneUpdateSchema = z.object({
  name: z.string().trim().min(2, 'এলাকার নাম দিন').max(60).optional(),
  districts: z.array(districtNameSchema).max(64, 'জেলা ৬৪টার বেশি নয়').optional(),
  chargePaisa: paisaSchema.optional(),
  freeAbovePaisa: paisaSchema.nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

/** কার্টে চার্জ দেখানোর জন্য — লগইন ছাড়াই ডাকা যায়। */
export const shippingQuoteQuerySchema = z.object({
  district: districtNameSchema,
  subtotalPaisa: z.coerce.number().int().min(0),
});

export type ShippingZoneInput = z.infer<typeof shippingZoneInputSchema>;
export type ShippingZoneUpdate = z.infer<typeof shippingZoneUpdateSchema>;
export type ShippingQuoteQuery = z.infer<typeof shippingQuoteQuerySchema>;
