import { z } from 'zod';

/**
 * Product reviews and ratings.
 *
 * **Why a review must be tied to an order item:** a rating is only
 * worth reading if it came from someone who actually received the
 * thing. Tying each review to one purchased line makes ten five-star
 * reviews cost ten purchases, which is the cheapest defence against
 * fake reviews that exists — no moderation queue can match it.
 *
 * **Why the average is computed and never stored:** approving,
 * unapproving or deleting a review changes the average. A stored
 * number would go stale silently, and a wrong rating nobody notices is
 * worse than a slow one.
 */

/** এক থেকে পাঁচ — আধা তারা নেই, কারণ গড়েই যথেষ্ট সূক্ষ্মতা আসে */
export const RATING_MIN = 1;
export const RATING_MAX = 5;

export const REVIEW_TITLE_MAX = 120;
export const REVIEW_BODY_MAX = 2000;
export const ADMIN_REPLY_MAX = 1000;

export const reviewInputSchema = z.object({
  /**
   * কোন অর্ডার-আইটেমের জন্য রিভিউ।
   *
   * পণ্যের `id` নয় — **আইটেমের** id। পণ্য দিয়ে পাঠালে সার্ভারকে
   * অনুমান করতে হতো "এই ক্রেতার কোন কেনাটার কথা বলছে", আর একাধিকবার
   * কিনলে সেই অনুমান ভুল হতো।
   */
  orderItemId: z.string().cuid(),
  rating: z.coerce.number().int().min(RATING_MIN).max(RATING_MAX),
  /** অনেকে শুধু তারা দিয়েই চলে যায়, তাই লেখা বাধ্যতামূলক নয় */
  title: z.string().trim().min(1).max(REVIEW_TITLE_MAX).optional(),
  body: z.string().trim().min(1).max(REVIEW_BODY_MAX).optional(),
});

/**
 * রিভিউ সম্পাদনা।
 *
 * মাঠগুলো আলাদা করে লেখা, `.partial()` নয় — `.partial()` `.default()`
 * রেখে দেয়, তাই না-পাঠানো মাঠ চুপচাপ ডিফল্টে বসে যেত (এই রিপোতে
 * আগে এটা আসল bug হয়ে ধরা পড়েছে)।
 *
 * `orderItemId` এখানে নেই — রিভিউ কোন কেনার, সেটা বদলানো যায় না।
 */
export const reviewUpdateSchema = z.object({
  rating: z.coerce.number().int().min(RATING_MIN).max(RATING_MAX).optional(),
  title: z.string().trim().min(1).max(REVIEW_TITLE_MAX).nullable().optional(),
  body: z.string().trim().min(1).max(REVIEW_BODY_MAX).nullable().optional(),
});

/** অ্যাডমিনের অনুমোদন — আলাদা endpoint, কারণ এটা ক্রেতার কাজ নয় */
export const reviewModerationSchema = z.object({
  isApproved: z.boolean(),
});

/** দোকানের জবাব। `null` পাঠালে জবাব মুছে যায়। */
export const reviewReplySchema = z.object({
  adminReply: z.string().trim().min(1).max(ADMIN_REPLY_MAX).nullable(),
});

export const reviewListQuerySchema = z.object({
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  /** নির্দিষ্ট তারায় ছাঁকা — "১ তারার রিভিউগুলো দেখি" */
  rating: z.coerce.number().int().min(RATING_MIN).max(RATING_MAX).optional(),
});

/**
 * অ্যাডমিনের তালিকা।
 *
 * `status` ডিফল্ট `pending`, কারণ অ্যাডমিন এই পাতায় আসে **অনুমোদনের
 * অপেক্ষায় থাকা** রিভিউ দেখতে। ডিফল্ট `all` হলে পুরোনো অনুমোদিত
 * রিভিউর ভিড়ে নতুনগুলো চাপা পড়ত।
 */
export const adminReviewListQuerySchema = z.object({
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(['pending', 'approved', 'all']).default('pending'),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;
export type ReviewUpdateInput = z.infer<typeof reviewUpdateSchema>;
export type ReviewModerationInput = z.infer<typeof reviewModerationSchema>;
export type ReviewReplyInput = z.infer<typeof reviewReplySchema>;
export type ReviewListQuery = z.infer<typeof reviewListQuerySchema>;
export type AdminReviewListQuery = z.infer<typeof adminReviewListQuerySchema>;

/**
 * রিভিউ লিখতে না পারার কারণ।
 *
 * কারণটা আলাদা করে ফেরানো হয়, কারণ ক্রেতাকে **কী করতে হবে** সেটা
 * বলা দরকার। শুধু ৪০৩ দিলে সে বুঝত না ডেলিভারির অপেক্ষা করতে হবে
 * নাকি সে আগেই লিখে ফেলেছে।
 */
export const REVIEW_REFUSAL = {
  NOT_YOURS: 'NOT_YOURS',
  NOT_DELIVERED: 'NOT_DELIVERED',
  ALREADY_REVIEWED: 'ALREADY_REVIEWED',
  PRODUCT_GONE: 'PRODUCT_GONE',
} as const;

export type ReviewRefusal = (typeof REVIEW_REFUSAL)[keyof typeof REVIEW_REFUSAL];

/** অ্যাডমিনকে দেখানোর বার্তা নয় — ক্রেতাকে দেখানোর, তাই বাংলায় */
export const REVIEW_REFUSAL_MESSAGE: Record<ReviewRefusal, string> = {
  [REVIEW_REFUSAL.NOT_YOURS]: 'এই অর্ডারটি আপনার নয়',
  [REVIEW_REFUSAL.NOT_DELIVERED]: 'পণ্য হাতে পাওয়ার পর রিভিউ দেওয়া যাবে',
  [REVIEW_REFUSAL.ALREADY_REVIEWED]: 'এই পণ্যের রিভিউ আপনি আগেই দিয়েছেন',
  [REVIEW_REFUSAL.PRODUCT_GONE]: 'পণ্যটি আর নেই',
};

/**
 * পণ্যের রেটিংয়ের সারসংক্ষেপ।
 *
 * `average` `null` হয় যখন একটাও অনুমোদিত রিভিউ নেই — `0` নয়, কারণ
 * শূন্য রেটিং মানে "সবাই খারাপ বলেছে", আর "কেউ কিছু বলেনি" সেটা নয়।
 * UI-তে দুটোর চেহারা আলাদা হওয়া দরকার।
 */
export interface RatingSummary {
  average: number | null;
  count: number;
  /** কত জন কত তারা দিল — বারচার্ট দেখাতে */
  breakdown: Record<string, number>;
}

/**
 * গড় বের করা, এক জায়গায়।
 *
 * API আর UI দুই পাশেই একই হিসাব দরকার (UI ঐচ্ছিকভাবে আগেই দেখাতে
 * পারে), আর দুই জায়গায় আলাদা লিখলে একদিন অমিল হতো।
 *
 * এক দশমিক ঘর পর্যন্ত — "৪.৩" যথেষ্ট, "৪.২৭" বিশ্বাসযোগ্যতা বাড়ায় না।
 */
export const ratingAverage = (ratings: readonly number[]): number | null => {
  if (ratings.length === 0) {
    return null;
  }

  const total = ratings.reduce((sum, rating) => sum + rating, 0);

  return Math.round((total / ratings.length) * 10) / 10;
};

/** প্রতিটা তারার ঘর সবসময় থাকে — শূন্যও, নইলে বারচার্টে ফাঁক পড়ত */
export const emptyBreakdown = (): Record<string, number> => ({
  '1': 0,
  '2': 0,
  '3': 0,
  '4': 0,
  '5': 0,
});
