import { z } from 'zod';

/**
 * Product search.
 *
 * **Why ILIKE and not `tsvector`:** Postgres' full-text parser decides
 * what a "word" is from the operating system's ctype. On a database
 * whose ctype is not UTF-8 aware — the default on Windows, where this
 * shop is developed — every Bengali letter is classified as *blank*,
 * so `to_tsvector('simple', 'নীল শার্ট')` returns nothing at all and a
 * GIN index on it would be empty. `pg_trgm` fails the same way:
 * `show_trgm('শার্ট')` comes back `{}`.
 *
 * That is not a tuning problem, it is the whole feature missing for the
 * language most buyers type in. ILIKE has no such blind spot: it
 * compares bytes, so Bengali, English and a mix of both all work, and
 * partial words work too — which matters, because buyers stop typing
 * early.
 *
 * The cost is that ILIKE cannot use a plain B-tree index for a leading
 * `%`, so this is a sequential scan. At the catalogue size this product
 * is built for (thousands, not millions) that is a few milliseconds,
 * and it needs no extra server — which a buyer running their own
 * install would otherwise have to pay for and keep alive.
 */

/** একই সীমা `productListQuerySchema`-র `search`-এর সাথে — দুই পথে এক নিয়ম। */
export const SEARCH_QUERY_MAX = 100;

export const productSearchQuerySchema = z.object({
  /**
   * যা টাইপ করা হয়েছে।
   *
   * `.trim()` আগে, `.min(1)` পরে — তাই শুধু স্পেস পাঠালে ৪০০ ফেরে।
   * ফাঁকা খোঁজায় পুরো ক্যাটালগ ফেরানো হয় না: ওটা তালিকার কাজ
   * (`GET /products`), আর সার্চ বলতে বোঝানো হয় কিছু খোঁজা হয়েছে।
   */
  q: z.string().trim().min(1).max(SEARCH_QUERY_MAX),
  cursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
});

export type ProductSearchQuery = z.infer<typeof productSearchQuerySchema>;

/**
 * ILIKE-এর pattern-এ বসানোর আগে ব্যবহারকারীর লেখা নিরাপদ করা।
 *
 * **কেন এটা জরুরি:** ILIKE-এ `%` মানে "যা খুশি", `_` মানে "যেকোনো এক
 * অক্ষর"। escape না করলে কেউ শুধু `%` লিখেই **পুরো ক্যাটালগ** টেনে
 * আনতে পারে — pagination থাকলেও সেটা খোঁজা নয়, ডেটা ডাম্প। আর `_`
 * লিখলে অপ্রত্যাশিত জিনিস মেলে, ফলে ফলাফল এলোমেলো দেখায়।
 *
 * এটা SQL injection ঠেকানোর ব্যবস্থা **নয়** — সেটা parameterised
 * query করে। এটা ঠেকায় wildcard injection, যেটা আলাদা সমস্যা আর
 * parameter দিয়ে ঠেকে না (মান parameter-এ গেলেও `%` এখনো wildcard)।
 *
 * `\` নিজেই escape অক্ষর, তাই সবার আগে সেটাই দ্বিগুণ করতে হয় — নইলে
 * `\%` লিখে escape-টাকেই ফাঁকি দেওয়া যেত।
 */
export const escapeLikePattern = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

/**
 * খালি ফলাফলের সাজেশন।
 *
 * "কিছু পাওয়া যায়নি" শেষ কথা নয় — ক্রেতা তখনই চলে যায়। তার বদলে
 * কোথায় ঘুরে দেখা যায় সেটা দেখানো হয়।
 */
export interface SearchSuggestion {
  name: string;
  slug: string;
}

export interface ProductSearchResult<TItem> {
  items: TItem[];
  nextCursor: string | null;
  /** ফল থাকলে খালি — তখন সাজেশন দেখানো মানে ক্রেতাকে সরিয়ে দেওয়া */
  suggestions: SearchSuggestion[];
}
