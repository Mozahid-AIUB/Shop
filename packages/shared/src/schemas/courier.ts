import { z } from 'zod';
import { COURIERS, COURIER_CREDENTIAL_FIELDS, SHIPMENT_STATUSES, type Courier } from '../constants/courier';

/**
 * কুরিয়ার সেটআপ ও পার্সেলের schema।
 *
 * **key কখনো response-এ ফেরে না** — শুধু শেষ ৪ অক্ষর। প্যানেলে
 * key দেখানোর দরকার নেই, শুধু "ঠিকটা বসানো আছে কি না" মেলানোর
 * দরকার।
 */

const courierKindSchema = z.enum(COURIERS);

/**
 * credential — মাঠের নাম কুরিয়ারভেদে আলাদা, তাই খোলা `record`।
 *
 * মানগুলো খালি হতে পারে না: খালি key বসালে পার্সেল পাঠানোর সময়
 * কুরিয়ার "unauthorized" বলত আর অ্যাডমিন ভাবত key-টাই ভুল, অথচ
 * আসলে কিছুই বসানো হয়নি।
 */
const credentialsSchema = z.record(
  z.string().trim().min(1),
  z.string().trim().min(1, 'মান খালি রাখা যাবে না'),
);

/**
 * কুরিয়ার অনুযায়ী দরকারি মাঠগুলো আছে কিনা।
 *
 * **কেন এখানেই যাচাই:** না করলে অ্যাডমিন Pathao-তে Steadfast-এর
 * মাঠ বসিয়ে দিতে পারত, আর ভুলটা ধরা পড়ত প্রথম পার্সেল পাঠানোর
 * সময় — অর্থাৎ ক্রেতা অপেক্ষা করছে এমন মুহূর্তে।
 */
const refineCredentials = (
  data: { kind: Courier; credentials?: Record<string, string> | null },
  ctx: z.RefinementCtx,
): void => {
  const required = COURIER_CREDENTIAL_FIELDS[data.kind];

  if (required.length === 0) {
    // MANUAL — কিছু লাগে না, আর কেউ পাঠালেও ক্ষতি নেই
    return;
  }

  const given = data.credentials;

  if (given === undefined || given === null) {
    // তৈরির সময় key না দিয়েও অ্যাকাউন্ট বানানো যায়, পরে বসানো হবে।
    // চালু করার সময় (`isActive`) service আবার যাচাই করে।
    return;
  }

  const missing = required.filter((field) => given[field] === undefined);

  if (missing.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['credentials'],
      message: `${data.kind}-এর জন্য দরকার: ${missing.join(', ')}`,
    });
  }

  const extra = Object.keys(given).filter((field) => !required.includes(field));

  /**
   * অপ্রয়োজনীয় মাঠ **চুপচাপ ফেলে দেওয়া হয় না**।
   *
   * ফেলে দিলে অ্যাডমিন ভাবত সেটা সংরক্ষিত হয়েছে আর কাজ করছে।
   * বানান ভুল (`apikey` বদলে `apiKey`) ঠিক এভাবেই ধরা পড়ে।
   */
  if (extra.length > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['credentials'],
      message: `${data.kind}-এ এই মাঠগুলো লাগে না: ${extra.join(', ')}`,
    });
  }
};

export const courierAccountInputSchema = z
  .object({
    kind: courierKindSchema,
    label: z.string().trim().min(1, 'নাম দিন').max(60),
    credentials: credentialsSchema.nullable().default(null),
    /**
     * `webhookSecret` ঐচ্ছিক, কিন্তু না দিলে webhook **নেওয়া হয় না**।
     *
     * ছাড়া webhook খোলা দরজা: যে কেউ "DELIVERED" পাঠিয়ে অর্ডার
     * ডেলিভারড দেখাত, আর COD-র টাকা না পেয়েই হিসাব মিলে যেত।
     */
    webhookSecret: z.string().trim().min(16, 'অন্তত ১৬ অক্ষর').max(200).nullable().default(null),
    /**
     * পার্সেলের ডিফল্ট ওজন, গ্রামে — পণ্যে ওজন লেখা না থাকলে এটা যায়।
     *
     * কুরিয়াররা ওজন **বাধ্যতামূলক** চায় (Pathao-তে ন্যূনতম ০.৫ কেজি),
     * তাই কিছু একটা পাঠাতেই হয়। ৫০০ গ্রাম ডিফল্ট: Pathao-র ন্যূনতম,
     * আর জামাকাপড়ে বাস্তবসম্মত। ভারী পণ্যের দোকান বাড়িয়ে নেবে।
     */
    defaultWeightGrams: z
      .number()
      .int('ওজন গ্রামে পূর্ণসংখ্যা হবে')
      .min(1, 'ওজন অন্তত ১ গ্রাম')
      .max(50_000, 'ওজন ৫০ কেজির বেশি নয়')
      .default(500),
    isActive: z.boolean().default(false),
    isDefault: z.boolean().default(false),
    isSandbox: z.boolean().default(false),
  })
  .superRefine(refineCredentials);

/**
 * আপডেট — যা পাঠানো হয়নি তা **অপরিবর্তিত** থাকবে।
 *
 * **`.partial()` ব্যবহার করা যায় না।** Zod-এ `.partial()` মাঠ
 * ঐচ্ছিক করে কিন্তু `.default()` সরায় না, তাই শুধু
 * `{ isActive: true }` পাঠালেও বাকি মাঠে default বসে যেত — key
 * মুছে যেত, webhook secret মুছে যেত। Phase 14-এ shipping zone-এ
 * আর Phase 15-এ কুপনে ঠিক এই বাগটাই ধরা পড়েছিল।
 *
 * `kind` নেই ইচ্ছাকৃতভাবে: কুরিয়ার বদলানো মানে অন্য কোম্পানি,
 * অন্য key, অন্য API। পুরোনো পার্সেলগুলোর ইতিহাসও তখন ভুল
 * কুরিয়ারে বাঁধা থাকত। নতুন কুরিয়ার লাগলে নতুন অ্যাকাউন্ট।
 */
export const courierAccountUpdateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  credentials: credentialsSchema.nullable().optional(),
  webhookSecret: z.string().trim().min(16).max(200).nullable().optional(),
  defaultWeightGrams: z.number().int().min(1).max(50_000).optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  isSandbox: z.boolean().optional(),
});

/**
 * অর্ডার কুরিয়ারে পাঠানো।
 *
 * **ঠিকানা বা টাকার অঙ্ক এখানে নেই** — সব অর্ডার থেকে পড়া হয়।
 * ক্লায়েন্ট পাঠাতে দিলে কেউ COD-র অঙ্ক বদলে দিত, আর কুরিয়ার কম
 * টাকা তুলে আনত।
 */
export const dispatchInputSchema = z.object({
  /** কোন কুরিয়ারে। না দিলে ডিফল্ট অ্যাকাউন্ট */
  courier: courierKindSchema.optional(),

  /**
   * `MANUAL`-এ হাতে বসানো ট্র্যাকিং নম্বর।
   *
   * API-ওয়ালা কুরিয়ারে এটা পাঠানো যায় না — নম্বর তারাই দেয়, আর
   * হাতে বসালে ভুল নম্বর ক্রেতার কাছে চলে যেত।
   */
  trackingCode: z.string().trim().min(1).max(60).optional(),

  /** কুরিয়ারকে দেওয়ার নোট — "বাসার গেটে কলিং বেল নেই" ইত্যাদি */
  note: z.string().trim().max(200).optional(),
});

/** অ্যাডমিন হাতে অবস্থা বদলায় — `MANUAL` কুরিয়ারে এটাই একমাত্র পথ। */
export const shipmentStatusUpdateSchema = z.object({
  status: z.enum(SHIPMENT_STATUSES),
  note: z.string().trim().max(200).optional(),
  /** ফেরত এলে কারণ — ঝুঁকির হিসাবেও কাজে লাগে */
  failureReason: z.string().trim().max(200).optional(),
});

export type CourierAccountInput = z.infer<typeof courierAccountInputSchema>;
export type CourierAccountUpdate = z.infer<typeof courierAccountUpdateSchema>;
export type DispatchInput = z.infer<typeof dispatchInputSchema>;
export type ShipmentStatusUpdate = z.infer<typeof shipmentStatusUpdateSchema>;

/**
 * প্যানেলে কুরিয়ার অ্যাকাউন্ট যেভাবে দেখায় — **key ছাড়া**।
 *
 * `credentials` পুরোটা কখনো ফেরে না। শুধু কোন মাঠ বসানো আছে আর
 * তার শেষ ৪ অক্ষর — এতে অ্যাডমিন মেলাতে পারে, কিন্তু key ফাঁস হলেও
 * কিছু করা যায় না।
 */
export type CourierAccountView = {
  id: string;
  kind: Courier;
  label: string;
  isActive: boolean;
  isDefault: boolean;
  isSandbox: boolean;
  defaultWeightGrams: number;
  /** কোন মাঠ বসানো আছে → masked মান। অনুপস্থিত মাঠ এখানে থাকে না */
  credentialHints: Record<string, string>;
  /** যে মাঠগুলো এখনো বসানো হয়নি — প্যানেল লাল দেখাতে পারে */
  missingFields: readonly string[];
  hasWebhookSecret: boolean;
  createdAt: Date;
  updatedAt: Date;
};
