import { Prisma } from '@prisma/client';
import type { RatingSummary } from '@shop/shared';

/**
 * Prisma selects and the view types built from them.
 *
 * Kept out of `products.service.ts` so that file stays one job — the
 * queries and rules — rather than also being the place every shape is
 * declared. `order-views.ts` was split out of the order service for
 * the same reason.
 */

/**
 * তালিকার কার্ড — নাম, দাম, একটা ছবি। পুরো variant সেট নয়।
 * `include` দিলে প্রতি প্রোডাক্টে আলাদা query হতো (N+1); `select` দিয়ে
 * শুধু সস্তা অংশটুকু একবারে আসে।
 */
export const LIST_SELECT = {
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
export const DETAIL_SELECT = {
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
    /** অনুমোদিত রিভিউ থেকে হিসাব করা — জমানো নয় (Phase 17) */
    rating: RatingSummary;
  }[];
  nextCursor: string | null;
}

export type ProductDetail = Prisma.ProductGetPayload<{ select: typeof DETAIL_SELECT }>;

/**
 * ক্রেতার দেখা পণ্যের পাতা — রেটিং সহ।
 *
 * অ্যাডমিনের `ProductDetail`-এ রেটিং নেই, কারণ পণ্য তৈরি বা সম্পাদনার
 * উত্তরে রিভিউর হিসাব করা অর্থহীন (নতুন পণ্যে রিভিউ থাকে না), আর
 * টাইপে রাখলে সেখানে ভুল করে শূন্য রেটিং দেখানো হতো।
 */
export type PublicProductDetail = ProductDetail & { rating: RatingSummary };

export type ProductCardRow = Prisma.ProductGetPayload<{ select: typeof LIST_SELECT }>;

export interface StockResult {
  id: string;
  sku: string;
  stock: number;
}
