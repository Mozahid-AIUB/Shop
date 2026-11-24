import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  escapeLikePattern,
  type CreateProductInput,
  type ProductListQuery,
  type UpdateProductInput,
  type UpdateStockInput,
} from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * তালিকার কার্ড — নাম, দাম, একটা ছবি। পুরো variant সেট নয়।
 * `include` দিলে প্রতি প্রোডাক্টে আলাদা query হতো (N+1); `select` দিয়ে
 * শুধু সস্তা অংশটুকু একবারে আসে।
 */
const LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  category: { select: { id: true, name: true, slug: true } },
  images: {
    select: { url: true, alt: true },
    orderBy: { sortOrder: 'asc' },
    take: 1,
  },
  variants: {
    where: { isActive: true },
    select: { pricePaisa: true, comparePricePaisa: true, stock: true },
    orderBy: { pricePaisa: 'asc' },
  },
} satisfies Prisma.ProductSelect;

/** একক প্রোডাক্টের পাতায় সবকিছুই লাগে। */
const DETAIL_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isPublished: true,
  createdAt: true,
  category: { select: { id: true, name: true, slug: true } },
  images: {
    select: { id: true, url: true, alt: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  },
  attributes: { select: { id: true, name: true, value: true } },
  variants: {
    select: {
      id: true,
      sku: true,
      pricePaisa: true,
      comparePricePaisa: true,
      stock: true,
      isActive: true,
      options: { select: { id: true, name: true, value: true } },
    },
    orderBy: { pricePaisa: 'asc' },
  },
} satisfies Prisma.ProductSelect;

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public তালিকা। Cursor pagination — `skip`/`take` নয়, কারণ বড় offset-এ
   * Postgres-কে বাদ দেওয়া row-গুলোও পড়তে হয়।
   *
   * `limit + 1` টেনে আনা হয়: বাড়তি row থাকা মানে পরের পাতা আছে,
   * আলাদা `count()` query লাগে না।
   */
  async list(query: ProductListQuery): Promise<ProductListResult> {
    const rows =
      query.sort === 'newest'
        ? await this.listByNewest(query)
        : await this.listByPrice(query);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: page.map((row) => this.toCard(row)),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /** নতুন পণ্য আগে — Prisma নিজেই পারে, cursor-ও `id` ধরে চলে। */
  private listByNewest(query: ProductListQuery): Promise<ProductCardRow[]> {
    return this.prisma.product.findMany({
      where: this.buildListWhere(query),
      select: LIST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
  }

  /**
   * দামে সাজানো।
   *
   * **কেন দুই ধাপ:** ক্রেতা যে দাম দেখে সেটা পণ্যের সবচেয়ে সস্তা
   * সক্রিয় variant-এর দাম, অর্থাৎ `MIN(pricePaisa)` — একটা সম্পর্কিত
   * টেবিলের সমষ্টি। Prisma-র `orderBy` এটা প্রকাশ করতে পারে না; আগে
   * এখানে `variants: { _count: 'asc' }` লেখা ছিল, যেটা **দাম নয়,
   * variant-এর সংখ্যা** ধরে সাজাত। ফলে "কম দাম আগে" চাপলে ক্রেতা
   * এলোমেলো ক্রম পেত।
   *
   * তাই ক্রমটা SQL-এ বের করা হয়, আর সাজানো `id` ধরে Prisma দিয়ে
   * বাকি তথ্য আনা হয় — এক জায়গায় ক্রম, আরেক জায়গায় তথ্য, দুটোই
   * নিজের কাজে সেরা।
   *
   * `cursor`-ও তাই `id` ধরে কাজ করে না; আগের পাতার শেষ পণ্যের দাম
   * বের করে `(দাম, id)` জোড়ার উপর তুলনা হয় (keyset pagination), যাতে
   * একই দামের দুটো পণ্য সীমানায় হারিয়ে বা দুবার না আসে।
   */
  private async listByPrice(query: ProductListQuery): Promise<ProductCardRow[]> {
    const ids = await this.orderedIdsByPrice(query);

    if (ids.length === 0) {
      return [];
    }

    const rows = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: LIST_SELECT,
    });

    // `IN` ক্রম রাখে না — SQL-এর ঠিক করা ক্রমে ফিরিয়ে সাজানো হয়
    const byId = new Map(rows.map((row) => [row.id, row]));

    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  /** Public detail — খসড়া প্রোডাক্ট slug জানা থাকলেও দেখা যাবে না। */
  async findPublishedBySlug(slug: string): Promise<ProductDetail> {
    const product = await this.prisma.product.findFirst({
      where: { slug, isPublished: true },
      select: DETAIL_SELECT,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return { ...product, variants: product.variants.filter((v) => v.isActive) };
  }

  /** Admin detail — খসড়াও দেখা যায়। */
  async findByIdForStaff(id: string): Promise<ProductDetail> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  /**
   * প্রোডাক্ট + variant + option + attribute + ছবি — সব এক transaction-এ।
   * আলাদা আলাদা লিখলে মাঝপথে ব্যর্থ হলে অর্ধেক প্রোডাক্ট পড়ে থাকত।
   */
  async create(input: CreateProductInput): Promise<ProductDetail> {
    try {
      const created = await this.prisma.product.create({
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          categoryId: input.categoryId,
          isPublished: input.isPublished,
          variants: {
            create: input.variants.map((variant) => ({
              sku: variant.sku,
              pricePaisa: variant.pricePaisa,
              comparePricePaisa: variant.comparePricePaisa ?? null,
              stock: variant.stock,
              // কুরিয়ারে পাঠানোর ওজন (Phase 10) — না দিলে কুরিয়ার সেটআপের ডিফল্ট
              weightGrams: variant.weightGrams ?? null,
              isActive: variant.isActive,
              options: { create: variant.options },
            })),
          },
          attributes: { create: input.attributes },
          images: { create: input.images },
        },
        select: DETAIL_SELECT,
      });

      return created;
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  /**
   * প্রোডাক্টের নিজস্ব ফিল্ড বদলায়। attribute আর ছবি পুরো সেট বদলে —
   * আংশিক merge করলে কোনটা মুছবে কোনটা থাকবে তা অস্পষ্ট হয়ে যায়।
   *
   * Variant এখানে নয় — দাম আর স্টক বদলানোর নিজস্ব পথ আছে (`adjustStock`),
   * আর অর্ডার ধরে রাখা variant আহতে মুছে ফেলা বিপজ্জনক।
   */
  async update(id: string, input: UpdateProductInput): Promise<ProductDetail> {
    const { attributes, images, ...fields } = input;

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (attributes) {
          await tx.productAttribute.deleteMany({ where: { productId: id } });
          await tx.productAttribute.createMany({
            data: attributes.map((attribute) => ({ ...attribute, productId: id })),
          });
        }

        if (images) {
          await tx.productImage.deleteMany({ where: { productId: id } });
          await tx.productImage.createMany({
            data: images.map((image) => ({ ...image, productId: id })),
          });
        }

        return tx.product.update({
          where: { id },
          data: fields,
          select: DETAIL_SELECT,
        });
      });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      // variant, option, attribute, image — schema-র cascade সামলাবে
      await this.prisma.product.delete({ where: { id } });
    } catch (error) {
      throw this.translateWriteError(error);
    }
  }

  /**
   * স্টক বদলানো। পরম মান নয়, **delta** — আর পড়ে-তারপর-লেখা নয়।
   *
   * `UPDATE ... WHERE stock >= :needed` এক ধাপে শর্ত যাচাই আর পরিবর্তন করে,
   * তাই দুজন একসাথে কমালেও একটার হিসাব হারায় না আর স্টক ঋণাত্মক হয় না।
   */
  async adjustStock(variantId: string, input: UpdateStockInput): Promise<StockResult> {
    const needed = input.delta < 0 ? -input.delta : 0;

    const updated = await this.prisma.productVariant.updateMany({
      where: { id: variantId, stock: { gte: needed } },
      data: { stock: { increment: input.delta } },
    });

    if (updated.count === 0) {
      const exists = await this.prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { stock: true },
      });

      if (!exists) {
        throw new NotFoundException('Variant not found');
      }

      throw new ConflictException(
        `Only ${exists.stock} left in stock — cannot remove ${needed}`,
      );
    }

    const variant = await this.prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { id: true, sku: true, stock: true },
    });

    return variant;
  }

  private buildListWhere(query: ProductListQuery): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = { isPublished: true };

    if (query.categorySlug) {
      // ক্যাটাগরি বা তার সন্তান — "ইলেকট্রনিক্স" চাপলে ফোনও আসবে
      where.category = {
        OR: [{ slug: query.categorySlug }, { parent: { slug: query.categorySlug } }],
      };
    }

    if (query.search) {
      /**
       * `escapeLikePattern` কেন: Prisma-র `contains` ভেতরে ILIKE-এ যায়,
       * তাই `%` আর `_` সেখানেও wildcard। escape না করলে `search=%`
       * দিয়ে **পুরো ক্যাটালগ** টেনে আনা যেত — খোঁজা নয়, ডেটা ডাম্প।
       *
       * ক্যাটাগরির নামও দেখা হয়, কারণ ক্রেতা অনেক সময় বিভাগের নামই
       * লেখে ("ইলেকট্রনিক্স"), পণ্যের নাম নয়।
       */
      const needle = escapeLikePattern(query.search);

      where.OR = [
        { name: { contains: needle, mode: 'insensitive' } },
        { description: { contains: needle, mode: 'insensitive' } },
        { category: { name: { contains: needle, mode: 'insensitive' } } },
      ];
    }

    if (query.minPricePaisa !== undefined || query.maxPricePaisa !== undefined) {
      where.variants = {
        some: {
          isActive: true,
          pricePaisa: {
            ...(query.minPricePaisa !== undefined ? { gte: query.minPricePaisa } : {}),
            ...(query.maxPricePaisa !== undefined ? { lte: query.maxPricePaisa } : {}),
          },
        },
      };
    }

    return where;
  }

  /**
   * দামের ক্রমে `id`-র তালিকা, এক query-তে।
   *
   * ফিল্টারগুলো (ক্যাটাগরি, খোঁজা, দামের সীমা) Prisma-র `where` থেকেই
   * আসে — দুই জায়গায় একই নিয়ম আবার লিখলে একদিন অমিল হতো। তাই আগে
   * Prisma দিয়ে মিলে যাওয়া `id`-গুলো নেওয়া হয়, তারপর সেগুলোর মধ্যে
   * দামে সাজানো হয়।
   *
   * `MIN` নেওয়া হয় **শুধু সক্রিয় variant-এর উপর**, কারণ ক্রেতা
   * নিষ্ক্রিয় variant কিনতে পারে না — তার দাম ধরে সাজালে পণ্যটা
   * ভুল জায়গায় বসত। সক্রিয় variant না থাকলে পণ্য তালিকায় থাকে
   * কিন্তু দামহীন, তাই `NULLS LAST` — দামহীন পণ্য শেষে।
   */
  private async orderedIdsByPrice(query: ProductListQuery): Promise<string[]> {
    const candidates = await this.prisma.product.findMany({
      where: this.buildListWhere(query),
      select: { id: true },
    });

    if (candidates.length === 0) {
      return [];
    }

    const ids = candidates.map((row) => row.id);
    const ascending = query.sort === 'price_asc';
    const after = query.cursor ? await this.pricePosition(query.cursor) : null;

    // cursor-এর পণ্য আর নেই (মুছে গেছে বা খসড়া হয়েছে) — তখন পাতা শেষ
    if (query.cursor !== undefined && after === null) {
      return [];
    }

    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH priced AS (
        SELECT
          p."id",
          (
            SELECT MIN(v."pricePaisa")
            FROM product_variants v
            WHERE v."productId" = p."id" AND v."isActive" = true
          ) AS price
        FROM products p
        WHERE p."id" IN (${Prisma.join(ids)})
      )
      SELECT "id"
      FROM priced
      WHERE ${
        after === null
          ? Prisma.sql`true`
          : ascending
            ? Prisma.sql`(COALESCE(price, 9223372036854775807), "id") > (COALESCE(${after.price}::bigint, 9223372036854775807), ${after.id})`
            : Prisma.sql`(COALESCE(price, -1), "id") < (COALESCE(${after.price}::bigint, -1), ${after.id})`
      }
      ORDER BY
        ${ascending ? Prisma.sql`price ASC NULLS LAST, "id" ASC` : Prisma.sql`price DESC NULLS LAST, "id" DESC`}
      LIMIT ${query.limit + 1}
    `;

    return rows.map((row) => row.id);
  }

  /** cursor-এর পণ্যের দাম — keyset তুলনার জন্য লাগে। */
  private async pricePosition(cursor: string): Promise<{ price: number | null; id: string } | null> {
    const product = await this.prisma.product.findFirst({
      where: { id: cursor, isPublished: true },
      select: {
        id: true,
        variants: {
          where: { isActive: true },
          select: { pricePaisa: true },
          orderBy: { pricePaisa: 'asc' },
          take: 1,
        },
      },
    });

    if (!product) {
      return null;
    }

    return { price: product.variants[0]?.pricePaisa ?? null, id: product.id };
  }

  /** তালিকার কার্ড — list আর search দুই পথেই এক চেহারা। */
  private toCard(row: ProductCardRow): ProductListResult['items'][number] {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      category: row.category,
      image: row.images[0] ?? null,
      // তালিকায় "৳৪৫০ থেকে" দেখাতে সবচেয়ে কম দামটাই যথেষ্ট
      fromPricePaisa: row.variants[0]?.pricePaisa ?? null,
      comparePricePaisa: row.variants[0]?.comparePricePaisa ?? null,
      inStock: row.variants.some((variant) => variant.stock > 0),
    };
  }

  private translateWriteError(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        const target = (error.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
        return new ConflictException(`A product with this ${target} already exists`);
      }

      if (error.code === 'P2025') {
        return new NotFoundException('Product not found');
      }

      if (error.code === 'P2003') {
        return new NotFoundException('Category not found');
      }
    }

    return error instanceof Error ? error : new Error('Unknown database error');
  }
}

export interface ProductListResult {
  items: {
    id: string;
    name: string;
    slug: string;
    category: { id: string; name: string; slug: string };
    image: { url: string; alt: string | null } | null;
    fromPricePaisa: number | null;
    comparePricePaisa: number | null;
    inStock: boolean;
  }[];
  nextCursor: string | null;
}

export type ProductDetail = Prisma.ProductGetPayload<{ select: typeof DETAIL_SELECT }>;

type ProductCardRow = Prisma.ProductGetPayload<{ select: typeof LIST_SELECT }>;

export interface StockResult {
  id: string;
  sku: string;
  stock: number;
}
