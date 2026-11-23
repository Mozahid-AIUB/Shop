import { z } from 'zod';

/**
 * Catalog validation — API-তে input যাচাই, web-এ অ্যাডমিন ফর্ম।
 * নিয়ম একবার লেখা হয়, দুই পাশে মেলে।
 */

/** URL-এ বসার মতো slug: ছোট হাতের অক্ষর, সংখ্যা, হাইফেন। */
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'slug দিন')
  .max(120, 'slug অনেক বড়')
  .regex(SLUG_REGEX, 'slug-এ শুধু ছোট হাতের অক্ষর, সংখ্যা আর হাইফেন চলবে');

/**
 * দাম সবসময় **integer paisa** — ১০০ টাকা = 10000।
 * float নিলে ০.১ + ০.২ ≠ ০.৩ সমস্যায় হিসাব মেলে না, তাই `.int()` বাধ্যতামূলক।
 */
export const paisaSchema = z
  .number()
  .int('দাম পয়সায় পূর্ণসংখ্যা হতে হবে (১০০ টাকা = 10000)')
  .nonnegative('দাম ঋণাত্মক হতে পারে না')
  // ~২১ কোটি টাকা — এর বেশি হলে ধরে নিচ্ছি ভুল করে টাকা-কে পয়সা ভাবা হয়েছে
  .max(2_000_000_000, 'দাম অস্বাভাবিক বড়');

export const stockSchema = z
  .number()
  .int('স্টক পূর্ণসংখ্যা হতে হবে')
  .nonnegative('স্টক ঋণাত্মক হতে পারে না')
  .max(1_000_000, 'স্টক অস্বাভাবিক বড়');

// ---------- Category ----------

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'নাম দিন').max(80, 'নাম অনেক বড়'),
  slug: slugSchema,
  /**
   * null মানে উপরের স্তর। গাছ সর্বোচ্চ **দুই স্তর** —
   * parent-এর নিজের parent থাকলে service সেটা বাতিল করবে,
   * কারণ গভীরতার নিয়ম DB constraint দিয়ে বলা যায় না।
   */
  parentId: z.string().cuid().nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

// ---------- Variant ----------

export const variantOptionSchema = z.object({
  /** "Color", "Size", "Storage" — পণ্যভেদে যা খুশি */
  name: z.string().trim().min(1, 'option-এর নাম দিন').max(40),
  value: z.string().trim().min(1, 'option-এর মান দিন').max(80),
});

export const createVariantSchema = z
  .object({
    sku: z.string().trim().min(1, 'SKU দিন').max(60),
    pricePaisa: paisaSchema,
    comparePricePaisa: paisaSchema.nullable().optional(),
    stock: stockSchema.default(0),
    isActive: z.boolean().default(true),
    options: z.array(variantOptionSchema).max(10, 'সর্বোচ্চ ১০টা option').default([]),
  })
  .refine(
    (v) =>
      v.comparePricePaisa === null ||
      v.comparePricePaisa === undefined ||
      v.comparePricePaisa > v.pricePaisa,
    {
      // নইলে "ছাড়" দেখিয়ে আসলে দাম বাড়ানো হয় — ক্রেতাকে বিভ্রান্ত করা
      message: 'আগের দাম বর্তমান দামের চেয়ে বেশি হতে হবে',
      path: ['comparePricePaisa'],
    },
  );

export const updateStockSchema = z.object({
  /**
   * পরম মান নয়, **পরিবর্তন** — "+১০ এলো", "-২ নষ্ট"।
   * পরম মান দিলে দুজন অ্যাডমিন একসাথে বদলালে একজনের হিসাব হারিয়ে যায়।
   */
  delta: z
    .number()
    .int('পরিবর্তন পূর্ণসংখ্যা হতে হবে')
    .refine((n) => n !== 0, 'পরিবর্তন শূন্য হতে পারে না'),
  reason: z.string().trim().max(200).optional(),
});

// ---------- Product ----------

export const productAttributeSchema = z.object({
  /** "Fabric", "RAM", "Warranty" — পণ্যভেদে আলাদা */
  name: z.string().trim().min(1, 'বৈশিষ্ট্যের নাম দিন').max(40),
  value: z.string().trim().min(1, 'বৈশিষ্ট্যের মান দিন').max(200),
});

export const productImageSchema = z.object({
  url: z.string().url('সঠিক URL দিন').max(500),
  alt: z.string().trim().max(200).optional(),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'নাম দিন').max(200, 'নাম অনেক বড়'),
  slug: slugSchema,
  description: z.string().trim().max(5000).nullable().optional(),
  categoryId: z.string().cuid('ক্যাটাগরি বাছুন'),
  isPublished: z.boolean().default(false),
  /** অন্তত একটা variant লাগবেই — variant ছাড়া দাম বা স্টক থাকে না */
  variants: z.array(createVariantSchema).min(1, 'অন্তত একটা variant দিন').max(100),
  attributes: z.array(productAttributeSchema).max(50).default([]),
  images: z.array(productImageSchema).max(20).default([]),
});

/**
 * সম্পাদনায় variant বাদ — দাম আর স্টক বদলানোর নিজস্ব পথ আছে।
 * আলাদা করে লেখা হয়েছে (`.omit().partial()` নয়) — নেস্টেড array সহ
 * স্কিমায় ওই চেইন TypeScript-এ গভীর টাইপ রিকারশন তৈরি করে।
 */
export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  slug: slugSchema.optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  categoryId: z.string().cuid().optional(),
  isPublished: z.boolean().optional(),
  attributes: z.array(productAttributeSchema).max(50).optional(),
  images: z.array(productImageSchema).max(20).optional(),
});

// ---------- Public catalog query ----------

export const productListQuerySchema = z.object({
  categorySlug: slugSchema.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  minPricePaisa: paisaSchema.optional(),
  maxPricePaisa: paisaSchema.optional(),
  /**
   * Cursor pagination — `skip`/`take` নয়।
   * বড় offset-এ Postgres-কে বাদ দেওয়া row-গুলোও পড়তে হয়, তাই ধীর হয়।
   */
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  sort: z.enum(['newest', 'price_asc', 'price_desc']).default('newest'),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type UpdateStockInput = z.infer<typeof updateStockSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

/** দেখানোর জন্য: 10000 → "১০০.০০" নয়, "100.00" — ফরম্যাট UI-র দায়িত্ব */
export const paisaToTaka = (paisa: number): string => (paisa / 100).toFixed(2);

/** ইনপুট থেকে: "100.50" → 10050 */
export const takaToPaisa = (taka: number): number => Math.round(taka * 100);
