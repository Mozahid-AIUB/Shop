import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  escapeLikePattern,
  type ProductSearchQuery,
  type ProductSearchResult,
  type SearchSuggestion,
} from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Product search for the storefront.
 *
 * **Why raw SQL here when the rest of the catalogue uses Prisma:** the
 * ordering is the feature. A buyer who types "laptop" must see the
 * laptops before the chair whose description happens to mention one,
 * and Prisma's query builder cannot express "rank by where the match
 * landed" — it can filter on related fields but not score them. Writing
 * it in SQL keeps the ranking in one readable `CASE`, and keeps the
 * whole search to a single round trip.
 *
 * Every user value is a bound parameter, so nothing here is string
 * concatenation. The pattern itself is escaped (see `escapeLikePattern`)
 * because binding a parameter does not stop `%` from being a wildcard.
 */

/** তালিকার কার্ডে যা লাগে — সার্চের ফলও সেই চেহারারই, নইলে UI দুরকম হতো। */
export interface SearchItem {
  id: string;
  name: string;
  slug: string;
  category: { id: string; name: string; slug: string };
  image: { url: string; alt: string | null } | null;
  fromPricePaisa: number | null;
  comparePricePaisa: number | null;
  inStock: boolean;
}

/** SQL থেকে যা ফেরে — snake_case, আর গোনা মান `bigint`। */
interface SearchRow {
  id: string;
  name: string;
  slug: string;
  category_id: string;
  category_name: string;
  category_slug: string;
  image_url: string | null;
  image_alt: string | null;
  from_price_paisa: bigint | number | null;
  compare_price_paisa: bigint | number | null;
  in_stock: boolean;
  rank: number;
  /** cursor-এর ক্রম ধরে রাখতে — rank সমান হলে এটাই ভাঙে */
  created_at: Date;
}

/**
 * কত পণ্য সাজেশনে দেখানো হবে।
 *
 * ক্যাটাগরি, কারণ ক্রেতা যা খুঁজছিল তা নেই — কিন্তু কাছাকাছি কিছু
 * থাকতে পারে। র‍্যান্ডম পণ্য দেখানোর চেয়ে "এই বিভাগগুলো দেখুন" বেশি
 * কাজে লাগে, আর এটা দোকানের আকার যা হোক কাজ করে।
 */
const SUGGESTION_LIMIT = 6;

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * খোঁজা।
   *
   * **ক্রম (`rank`), যেটাই এই ফিচারের আসল কাজ:**
   *
   * 1. নাম ঠিক এই লেখা দিয়েই শুরু — "laptop" লিখলে "Laptop Sleeve"
   * 2. নামের ভেতরে আছে — "Gaming Laptop"
   * 3. ক্যাটাগরির নামে আছে — ক্রেতা বিভাগের নাম লিখলেও পায়
   * 4. বিবরণে আছে — সবচেয়ে দুর্বল সংকেত, তাই সবার শেষে
   *
   * একই rank-এ নতুন পণ্য আগে। `id` সবশেষে, কারণ cursor pagination-এ
   * ক্রম অদ্বিতীয় না হলে পাতার সীমানায় row হারায় বা দুবার আসে।
   */
  async search(query: ProductSearchQuery): Promise<ProductSearchResult<SearchItem>> {
    const pattern = `%${escapeLikePattern(query.q)}%`;
    const prefix = `${escapeLikePattern(query.q)}%`;

    const rows = await this.runSearch(query, pattern, prefix);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: page.map((row) => this.toItem(row)),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      // ফল পেলে সাজেশন দেখানো মানে ক্রেতাকে অন্যদিকে সরিয়ে দেওয়া
      suggestions: page.length === 0 ? await this.suggestCategories() : [],
    };
  }

  /**
   * cursor থাকলে আগের পাতার শেষ row-টার rank ও সময় জেনে নিতে হয়,
   * নইলে "এর পরের গুলো" বলা যায় না।
   *
   * **কেন `id`-র চেয়ে জটিল:** সাধারণ cursor pagination-এ `id > cursor`
   * যথেষ্ট, কিন্তু এখানে ক্রম rank ধরে। তাই আগের row-এর rank বের করে
   * `(rank, createdAt, id)` — এই তিনটের উপর tuple তুলনা করা হয়।
   */
  private async runSearch(
    query: ProductSearchQuery,
    pattern: string,
    prefix: string,
  ): Promise<SearchRow[]> {
    const after = query.cursor ? await this.cursorPosition(query.cursor, pattern, prefix) : null;

    // cursor দেওয়া হয়েছে কিন্তু সেই পণ্য আর নেই (মুছে গেছে বা খসড়া হয়ে গেছে)
    if (query.cursor !== undefined && after === null) {
      return [];
    }

    const keyset = after
      ? Prisma.sql`AND (p."rank", p."createdAt", p."id") < (${after.rank}, ${after.createdAt}, ${after.id})`
      : Prisma.empty;

    return this.prisma.$queryRaw<SearchRow[]>`
      WITH matched AS (
        SELECT
          pr."id",
          pr."name",
          pr."slug",
          pr."createdAt",
          c."id"   AS category_id,
          c."name" AS category_name,
          c."slug" AS category_slug,
          CASE
            WHEN pr."name" ILIKE ${prefix}  THEN 4
            WHEN pr."name" ILIKE ${pattern} THEN 3
            WHEN c."name"  ILIKE ${pattern} THEN 2
            ELSE 1
          END AS "rank"
        FROM products pr
        JOIN categories c ON c."id" = pr."categoryId"
        WHERE pr."isPublished" = true
          AND (
            pr."name" ILIKE ${pattern}
            OR c."name" ILIKE ${pattern}
            OR pr."description" ILIKE ${pattern}
          )
      )
      SELECT
        p."id",
        p."name",
        p."slug",
        p."rank",
        p."createdAt" AS created_at,
        p.category_id,
        p.category_name,
        p.category_slug,
        img."url" AS image_url,
        img."alt" AS image_alt,
        price.from_price_paisa,
        price.compare_price_paisa,
        COALESCE(stock.in_stock, false) AS in_stock
      FROM matched p
      LEFT JOIN LATERAL (
        SELECT i."url", i."alt"
        FROM product_images i
        WHERE i."productId" = p."id"
        ORDER BY i."sortOrder" ASC
        LIMIT 1
      ) img ON true
      LEFT JOIN LATERAL (
        SELECT v."pricePaisa" AS from_price_paisa, v."comparePricePaisa" AS compare_price_paisa
        FROM product_variants v
        WHERE v."productId" = p."id" AND v."isActive" = true
        ORDER BY v."pricePaisa" ASC
        LIMIT 1
      ) price ON true
      LEFT JOIN LATERAL (
        SELECT true AS in_stock
        FROM product_variants v
        WHERE v."productId" = p."id" AND v."isActive" = true AND v."stock" > 0
        LIMIT 1
      ) stock ON true
      WHERE true ${keyset}
      ORDER BY p."rank" DESC, p."createdAt" DESC, p."id" DESC
      LIMIT ${query.limit + 1}
    `;
  }

  /**
   * cursor-এর পণ্যটা কোন অবস্থানে ছিল।
   *
   * rank আবার হিসাব করা হয় কারণ সেটা **খোঁজার লেখার উপর নির্ভর করে** —
   * জমিয়ে রাখা যায় না। একই পণ্য "laptop" খুঁজলে rank 4, "cover"
   * খুঁজলে 1।
   */
  private async cursorPosition(
    cursor: string,
    pattern: string,
    prefix: string,
  ): Promise<{ rank: number; createdAt: Date; id: string } | null> {
    const rows = await this.prisma.$queryRaw<{ rank: number; createdAt: Date; id: string }[]>`
      SELECT
        pr."id",
        pr."createdAt",
        CASE
          WHEN pr."name" ILIKE ${prefix}  THEN 4
          WHEN pr."name" ILIKE ${pattern} THEN 3
          WHEN c."name"  ILIKE ${pattern} THEN 2
          ELSE 1
        END AS "rank"
      FROM products pr
      JOIN categories c ON c."id" = pr."categoryId"
      WHERE pr."id" = ${cursor} AND pr."isPublished" = true
      LIMIT 1
    `;

    const row = rows[0];

    return row ? { rank: Number(row.rank), createdAt: row.createdAt, id: row.id } : null;
  }

  /** যে বিভাগে সত্যিই প্রকাশিত পণ্য আছে — খালি বিভাগ দেখানো অর্থহীন। */
  private async suggestCategories(): Promise<SearchSuggestion[]> {
    const rows = await this.prisma.category.findMany({
      where: { products: { some: { isPublished: true } } },
      select: { name: true, slug: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      take: SUGGESTION_LIMIT,
    });

    return rows;
  }

  private toItem(row: SearchRow): SearchItem {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      category: { id: row.category_id, name: row.category_name, slug: row.category_slug },
      image: row.image_url === null ? null : { url: row.image_url, alt: row.image_alt },
      // bigint আসতে পারে — JSON-এ bigint সরাসরি গেলে serialise ব্যর্থ হয়
      fromPricePaisa: row.from_price_paisa === null ? null : Number(row.from_price_paisa),
      comparePricePaisa:
        row.compare_price_paisa === null ? null : Number(row.compare_price_paisa),
      inStock: row.in_stock,
    };
  }
}
