import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  REVIEW_REFUSAL,
  REVIEW_REFUSAL_MESSAGE,
  emptyBreakdown,
  ratingAverage,
  type AdminReviewListQuery,
  type RatingSummary,
  type ReviewInput,
  type ReviewListQuery,
  type ReviewModerationInput,
  type ReviewReplyInput,
  type ReviewUpdateInput,
} from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Reviews and ratings.
 *
 * **The rule everything else serves:** only someone who received the
 * product may review it, once per purchase. That is checked against
 * the order itself — not against a flag the client sends — because any
 * claim the browser makes about having bought something can be forged.
 */

/** ক্রেতাকে দেখানো রিভিউ — ইমেইল কখনো নয়, শুধু নাম। */
const PUBLIC_SELECT = {
  id: true,
  rating: true,
  title: true,
  body: true,
  adminReply: true,
  adminReplyAt: true,
  createdAt: true,
  user: { select: { name: true } },
} satisfies Prisma.ReviewSelect;

/** লেখকের নিজের তালিকা — অনুমোদনের অবস্থাও দরকar, সে জানবে কেন দেখা যাচ্ছে না। */
const OWN_SELECT = {
  id: true,
  rating: true,
  title: true,
  body: true,
  isApproved: true,
  adminReply: true,
  adminReplyAt: true,
  createdAt: true,
  product: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ReviewSelect;

/** অ্যাডমিনের তালিকা — কে লিখেছে আর কোন অর্ডারে, দুটোই যাচাইয়ের জন্য লাগে। */
const ADMIN_SELECT = {
  id: true,
  productId: true,
  rating: true,
  title: true,
  body: true,
  isApproved: true,
  adminReply: true,
  adminReplyAt: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
  product: { select: { name: true, slug: true } },
  orderItem: { select: { order: { select: { orderNumber: true } } } },
} satisfies Prisma.ReviewSelect;

export type PublicReview = Prisma.ReviewGetPayload<{ select: typeof PUBLIC_SELECT }>;
export type OwnReview = Prisma.ReviewGetPayload<{ select: typeof OWN_SELECT }>;
export type AdminReview = Prisma.ReviewGetPayload<{ select: typeof ADMIN_SELECT }>;

export interface PublicReviewPage {
  items: PublicReview[];
  nextCursor: string | null;
  summary: RatingSummary;
}

export interface ReviewPage<TItem> {
  items: TItem[];
  nextCursor: string | null;
}

@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * রিভিউ লেখা।
   *
   * **তিনটে শর্ত, এই ক্রমে:** আইটেমটা এই ক্রেতার কি না, অর্ডারটা
   * ডেলিভার হয়েছে কি না, আর আগে রিভিউ দেওয়া হয়েছে কি না।
   *
   * ক্রমটা ইচ্ছাকৃত — মালিকানা আগে যাচাই হয়, কারণ অন্যের অর্ডারের
   * অবস্থা ফাঁস করা চলবে না। উল্টো করলে "ডেলিভার হয়নি" বার্তা দিয়েই
   * কেউ অন্যের অর্ডার কোথায় আছে বুঝে ফেলত।
   *
   * **`productId` এখানে কপি হয়** — `OrderItem.variantId` পরে `null`
   * হয়ে যেতে পারে (variant মুছলে), আর রিভিউ variant-এর নয়, পণ্যের।
   */
  async create(userId: string, input: ReviewInput): Promise<OwnReview> {
    const item = await this.prisma.orderItem.findUnique({
      where: { id: input.orderItemId },
      select: {
        id: true,
        order: { select: { userId: true, status: true } },
        variant: { select: { productId: true } },
        review: { select: { id: true } },
      },
    });

    // অজানা আইডি আর অন্যের আইডি — একই উত্তর, নইলে কোন আইডি সত্যি তা জানা যেত
    if (item === null || item.order.userId !== userId) {
      throw new ForbiddenException(REVIEW_REFUSAL_MESSAGE[REVIEW_REFUSAL.NOT_YOURS]);
    }

    if (item.order.status !== 'DELIVERED') {
      throw new ForbiddenException(REVIEW_REFUSAL_MESSAGE[REVIEW_REFUSAL.NOT_DELIVERED]);
    }

    if (item.review !== null) {
      throw new ConflictException(REVIEW_REFUSAL_MESSAGE[REVIEW_REFUSAL.ALREADY_REVIEWED]);
    }

    const productId = item.variant?.productId;

    // variant মুছে ফেলা হয়েছে — কোন পণ্যের রিভিউ সেটা আর জানার উপায় নেই
    if (productId === undefined) {
      throw new NotFoundException(REVIEW_REFUSAL_MESSAGE[REVIEW_REFUSAL.PRODUCT_GONE]);
    }

    try {
      return await this.prisma.review.create({
        data: {
          productId,
          userId,
          orderItemId: item.id,
          rating: input.rating,
          title: input.title ?? null,
          body: input.body ?? null,
        },
        select: OWN_SELECT,
      });
    } catch (error) {
      /**
       * দুটো অনুরোধ একসাথে এলে উপরের `item.review` পরীক্ষা দুটোতেই
       * পাস করে যেত, আর দ্বিতীয়টা `orderItemId`-র unique index-এ
       * আটকাত। DB-র নিয়মটাই শেষ কথা, তাই সেটাকে বার্তায় অনুবাদ করা হয়।
       */
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(REVIEW_REFUSAL_MESSAGE[REVIEW_REFUSAL.ALREADY_REVIEWED]);
      }

      throw error;
    }
  }

  /**
   * লেখক নিজের রিভিউ বদলায়।
   *
   * **সম্পাদনা করলে অনুমোদন চলে যায়** (`isApproved: false`)। নইলে
   * একটা ভালো রিভিউ অনুমোদন করিয়ে নিয়ে পরে সেটার লেখা বদলে গালি বা
   * প্রতিযোগীর বিজ্ঞাপন বসিয়ে দেওয়া যেত — moderation তখন অর্থহীন।
   */
  async update(userId: string, reviewId: string, input: ReviewUpdateInput): Promise<OwnReview> {
    await this.assertAuthor(userId, reviewId);

    return this.prisma.review.update({
      where: { id: reviewId },
      data: {
        ...(input.rating === undefined ? {} : { rating: input.rating }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.body === undefined ? {} : { body: input.body }),
        isApproved: false,
      },
      select: OWN_SELECT,
    });
  }

  /**
   * লেখক নিজের রিভিউ মোছে।
   *
   * মুছলে `orderItemId`-র unique সীমাও মুক্ত হয়, তাই সে আবার লিখতে
   * পারে। মন বদলানোর অধিকার থাকা উচিত, আর এতে ভুয়া রিভিউর পথ খোলে
   * না — প্রতিবার একটাই রিভিউ, আর সেটা একটা আসল কেনার বিপরীতে।
   */
  async remove(userId: string, reviewId: string): Promise<void> {
    await this.assertAuthor(userId, reviewId);

    await this.prisma.review.delete({ where: { id: reviewId } });
  }

  /** "আমার রিভিউ" — অনুমোদনের অপেক্ষায় থাকাগুলোও, নইলে সে ভাবত হারিয়ে গেছে। */
  async listMine(userId: string, query: ReviewListQuery): Promise<ReviewPage<OwnReview>> {
    const rows = await this.prisma.review.findMany({
      where: { userId, ...(query.rating === undefined ? {} : { rating: query.rating }) },
      select: OWN_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    return this.paginate(rows, query.limit);
  }

  /**
   * পণ্যের পাতার রিভিউ — **শুধু অনুমোদিত**।
   *
   * সারসংক্ষেপ একই query-র অংশ নয়, কারণ গড় পুরো পণ্যের উপর, শুধু
   * এই পাতার উপর নয় — আর তারায় ছাঁকলেও গড় বদলানো চলবে না।
   */
  async listForProduct(slug: string, query: ReviewListQuery): Promise<PublicReviewPage> {
    const product = await this.prisma.product.findFirst({
      where: { slug, isPublished: true },
      select: { id: true },
    });

    if (product === null) {
      throw new NotFoundException('Product not found');
    }

    const rows = await this.prisma.review.findMany({
      where: {
        productId: product.id,
        isApproved: true,
        ...(query.rating === undefined ? {} : { rating: query.rating }),
      },
      select: PUBLIC_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const page = this.paginate(rows, query.limit);

    return { ...page, summary: await this.summaryFor(product.id) };
  }

  /** অ্যাডমিনের সারি — ডিফল্টে অনুমোদনের অপেক্ষায় থাকাগুলো। */
  async listForAdmin(query: AdminReviewListQuery): Promise<ReviewPage<AdminReview>> {
    const where: Prisma.ReviewWhereInput =
      query.status === 'all' ? {} : { isApproved: query.status === 'approved' };

    const rows = await this.prisma.review.findMany({
      where,
      select: ADMIN_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    return this.paginate(rows, query.limit);
  }

  async moderate(reviewId: string, input: ReviewModerationInput): Promise<AdminReview> {
    await this.assertExists(reviewId);

    return this.prisma.review.update({
      where: { id: reviewId },
      data: { isApproved: input.isApproved },
      select: ADMIN_SELECT,
    });
  }

  /**
   * দোকানের জবাব।
   *
   * `adminReply` `null` হলে সময়টাও মুছে যায় — নইলে "জবাব নেই কিন্তু
   * জবাবের তারিখ আছে" এমন অসম্ভব অবস্থা তৈরি হতো।
   */
  async reply(reviewId: string, input: ReviewReplyInput): Promise<AdminReview> {
    await this.assertExists(reviewId);

    return this.prisma.review.update({
      where: { id: reviewId },
      data: {
        adminReply: input.adminReply,
        adminReplyAt: input.adminReply === null ? null : new Date(),
      },
      select: ADMIN_SELECT,
    });
  }

  /**
   * একটা পণ্যের রেটিং।
   *
   * `groupBy` দিয়ে গোনা হয়, প্রতিটা রিভিউ টেনে এনে নয় — হাজার রিভিউ
   * থাকলে সেগুলো বয়ে আনা অর্থহীন যখন শুধু সংখ্যা দরকার।
   */
  async summaryFor(productId: string): Promise<RatingSummary> {
    const groups = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { productId, isApproved: true },
      _count: { rating: true },
    });

    return this.toSummary(groups);
  }

  /**
   * অনেক পণ্যের রেটিং একবারে।
   *
   * **কেন এটা আলাদা:** তালিকার প্রতিটা পণ্যে `summaryFor` ডাকলে
   * ২৪টা পণ্যের পাতায় ২৪টা query হতো (N+1)। একটা `groupBy` সবগুলোর
   * হিসাব একসাথে আনে।
   */
  async summariesFor(productIds: readonly string[]): Promise<Map<string, RatingSummary>> {
    const result = new Map<string, RatingSummary>();

    if (productIds.length === 0) {
      return result;
    }

    const groups = await this.prisma.review.groupBy({
      by: ['productId', 'rating'],
      where: { productId: { in: [...productIds] }, isApproved: true },
      _count: { rating: true },
    });

    const byProduct = new Map<string, { rating: number; _count: { rating: number } }[]>();

    for (const group of groups) {
      const list = byProduct.get(group.productId) ?? [];
      list.push({ rating: group.rating, _count: group._count });
      byProduct.set(group.productId, list);
    }

    // রিভিউহীন পণ্যও সারসংক্ষেপ পায় — UI-তে মাঠটা কখনো অনুপস্থিত থাকে না
    for (const productId of productIds) {
      result.set(productId, this.toSummary(byProduct.get(productId) ?? []));
    }

    return result;
  }

  private toSummary(
    groups: readonly { rating: number; _count: { rating: number } }[],
  ): RatingSummary {
    const breakdown = emptyBreakdown();
    const ratings: number[] = [];

    for (const group of groups) {
      const count = group._count.rating;
      breakdown[String(group.rating)] = count;

      // গড় বের করতে প্রতিটা মান যতবার আছে ততবার লাগে
      for (let i = 0; i < count; i += 1) {
        ratings.push(group.rating);
      }
    }

    return { average: ratingAverage(ratings), count: ratings.length, breakdown };
  }

  private async assertAuthor(userId: string, reviewId: string): Promise<void> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { userId: true },
    });

    // অজানা আর অন্যের — একই উত্তর
    if (review === null || review.userId !== userId) {
      throw new ForbiddenException(REVIEW_REFUSAL_MESSAGE[REVIEW_REFUSAL.NOT_YOURS]);
    }
  }

  private async assertExists(reviewId: string): Promise<void> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId },
      select: { id: true },
    });

    if (review === null) {
      throw new NotFoundException('Review not found');
    }
  }

  private paginate<TItem extends { id: string }>(
    rows: TItem[],
    limit: number,
  ): ReviewPage<TItem> {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return { items: page, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
  }
}
