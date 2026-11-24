import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Reviews and ratings.
 *
 * **What these tests are really guarding:** a review is only worth
 * reading if it came from someone who received the product, so most of
 * this file is about refusing people — someone who never bought it,
 * someone whose parcel has not arrived, someone reviewing the same
 * purchase twice, and someone trying to review through another
 * customer's order. Each of those is a way fake reviews get in.
 *
 * Needs the real database.
 */
describe('Reviews', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const staffEmail = `rev-staff-${stamp}@test.local`;
  const buyerEmail = `rev-buyer-${stamp}@test.local`;
  const strangerEmail = `rev-stranger-${stamp}@test.local`;
  const password = 'secret123';

  let staffToken = '';
  let buyerToken = '';
  let strangerToken = '';

  let categoryId = '';
  let productId = '';
  let productSlug = '';
  let variantId = '';

  /** ডেলিভারি হয়ে যাওয়া অর্ডারের আইটেম — এটাই রিভিউর অধিকার */
  let deliveredItemId = '';
  /** এখনো পথে — রিভিউ দেওয়া যাবে না */
  let pendingItemId = '';
  /** অন্য ক্রেতার আইটেম */
  let strangerItemId = '';

  const auth = (token: string): [string, string] => ['authorization', `Bearer ${token}`];

  /**
   * অর্ডার সরাসরি DB-তে বানানো হয়, checkout দিয়ে নয়।
   *
   * **কেন:** checkout-এ স্টক, কুপন, শিপিং zone, COD ঝুঁকি — সব জড়িত,
   * আর এই টেস্টের বিষয় সেগুলো নয়। অবস্থাটা (DELIVERED) সোজা বসিয়ে
   * দিলে টেস্ট যা পরীক্ষা করছে তার উপরেই থাকে, আর অন্য phase-এর কোনো
   * নিয়ম বদলালে এখানে অকারণে ভাঙে না।
   */
  const makeOrder = async (
    userId: string | null,
    status: 'DELIVERED' | 'SHIPPED',
    suffix: string,
  ): Promise<string> => {
    const order = await prisma.order.create({
      data: {
        orderNumber: `ORD-REV-${stamp}-${suffix}`,
        userId,
        status,
        paymentStatus: 'PAID',
        subtotalPaisa: 50000,
        totalPaisa: 50000,
        shipFullName: 'Test Buyer',
        shipPhone: `0171${stamp.toString().slice(-7)}`,
        shipLine1: 'Road 1',
        shipCity: 'Dhaka',
        shipDistrict: 'Dhaka',
        items: {
          create: [
            {
              variantId,
              productName: 'Reviewable Thing',
              variantSku: `rev-sku-${stamp}`,
              unitPricePaisa: 50000,
              quantity: 1,
              lineTotalPaisa: 50000,
            },
          ],
        },
      },
      select: { items: { select: { id: true } } },
    });

    const itemId = order.items[0]?.id;

    if (itemId === undefined) {
      throw new Error('order created without an item');
    }

    return itemId;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    for (const email of [staffEmail, buyerEmail, strangerEmail]) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password, name: 'Person' })
        .expect(201);
    }

    await prisma.user.update({ where: { email: staffEmail }, data: { role: 'SUPER_ADMIN' } });

    const tokens: Record<string, string> = {};
    for (const email of [staffEmail, buyerEmail, strangerEmail]) {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      tokens[email] = login.body.accessToken;
    }

    staffToken = tokens[staffEmail] ?? '';
    buyerToken = tokens[buyerEmail] ?? '';
    strangerToken = tokens[strangerEmail] ?? '';

    const category = await request(app.getHttpServer())
      .post('/admin/categories')
      .set(...auth(staffToken))
      .send({ name: 'Reviewed', slug: `reviewed-${stamp}` })
      .expect(201);
    categoryId = category.body.id;

    productSlug = `reviewable-${stamp}`;
    const product = await request(app.getHttpServer())
      .post('/admin/products')
      .set(...auth(staffToken))
      .send({
        name: 'Reviewable Thing',
        slug: productSlug,
        description: 'Something to rate',
        categoryId,
        isPublished: true,
        variants: [
          { sku: `rev-sku-${stamp}`, pricePaisa: 50000, stock: 10, isActive: true, options: [] },
        ],
        attributes: [],
        images: [],
      })
      .expect(201);
    productId = product.body.id;
    variantId = product.body.variants[0].id;

    const buyer = await prisma.user.findUniqueOrThrow({ where: { email: buyerEmail } });
    const stranger = await prisma.user.findUniqueOrThrow({ where: { email: strangerEmail } });

    deliveredItemId = await makeOrder(buyer.id, 'DELIVERED', 'D1');
    pendingItemId = await makeOrder(buyer.id, 'SHIPPED', 'S1');
    strangerItemId = await makeOrder(stranger.id, 'DELIVERED', 'X1');
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { product: { slug: productSlug } } });
    await prisma.order.deleteMany({ where: { orderNumber: { startsWith: `ORD-REV-${stamp}` } } });
    await prisma.product.deleteMany({ where: { slug: productSlug } });
    await prisma.category.deleteMany({ where: { slug: `reviewed-${stamp}` } });
    await prisma.user.deleteMany({
      where: { email: { in: [staffEmail, buyerEmail, strangerEmail] } },
    });
    await app.close();
  });

  describe('who may write one', () => {
    it('refuses someone who is not signed in', async () => {
      await request(app.getHttpServer())
        .post('/reviews')
        .send({ orderItemId: deliveredItemId, rating: 5 })
        .expect(401);
    });

    it('refuses a customer reviewing an order that is not theirs', async () => {
      const response = await request(app.getHttpServer())
        .post('/reviews')
        .set(...auth(strangerToken))
        .send({ orderItemId: deliveredItemId, rating: 5, body: 'Never bought it' })
        .expect(403);

      expect(response.body.message).toContain('আপনার নয়');
    });

    it('refuses a review before the parcel arrives', async () => {
      const response = await request(app.getHttpServer())
        .post('/reviews')
        .set(...auth(buyerToken))
        .send({ orderItemId: pendingItemId, rating: 1, body: 'Still waiting' })
        .expect(403);

      // পণ্য না পেয়ে লেখা রিভিউ পণ্যের রিভিউ নয়, অপেক্ষার বিরক্তি
      expect(response.body.message).toContain('হাতে পাওয়ার পর');
    });

    it('lets the buyer review a delivered item', async () => {
      const response = await request(app.getHttpServer())
        .post('/reviews')
        .set(...auth(buyerToken))
        .send({ orderItemId: deliveredItemId, rating: 5, title: 'Great', body: 'Works well' })
        .expect(201);

      expect(response.body).toMatchObject({ rating: 5, title: 'Great', isApproved: false });
    });

    it('refuses a second review for the same purchase', async () => {
      const response = await request(app.getHttpServer())
        .post('/reviews')
        .set(...auth(buyerToken))
        .send({ orderItemId: deliveredItemId, rating: 1, body: 'Changed my mind' })
        .expect(409);

      expect(response.body.message).toContain('আগেই দিয়েছেন');
    });

    it('refuses an unknown order item', async () => {
      await request(app.getHttpServer())
        .post('/reviews')
        .set(...auth(buyerToken))
        .send({ orderItemId: 'cjld2cjxh0000qzrmn831i7rn', rating: 5 })
        .expect(403);
    });
  });

  describe('what a review may contain', () => {
    it('refuses a rating above five', async () => {
      await request(app.getHttpServer())
        .post('/reviews')
        .set(...auth(strangerToken))
        .send({ orderItemId: strangerItemId, rating: 6 })
        .expect(400);
    });

    it('refuses a rating of zero', async () => {
      await request(app.getHttpServer())
        .post('/reviews')
        .set(...auth(strangerToken))
        .send({ orderItemId: strangerItemId, rating: 0 })
        .expect(400);
    });

    it('refuses a fractional rating', async () => {
      await request(app.getHttpServer())
        .post('/reviews')
        .set(...auth(strangerToken))
        .send({ orderItemId: strangerItemId, rating: 4.5 })
        .expect(400);
    });

    it('accepts a rating with no words at all', async () => {
      // অনেকে শুধু তারা দিয়েই চলে যায় — সেটাও তথ্য
      const response = await request(app.getHttpServer())
        .post('/reviews')
        .set(...auth(strangerToken))
        .send({ orderItemId: strangerItemId, rating: 4 })
        .expect(201);

      expect(response.body).toMatchObject({ rating: 4, title: null, body: null });
    });
  });

  describe('what the public sees', () => {
    it('hides a review until an admin approves it', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products/${productSlug}/reviews`)
        .expect(200);

      // দুটো রিভিউ আছে, কোনোটাই অনুমোদিত নয়
      expect(response.body.items).toEqual([]);
    });

    it('reports no rating at all while nothing is approved', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products/${productSlug}/reviews`)
        .expect(200);

      // `0` নয় — শূন্য মানে "সবাই খারাপ বলেছে", এটা "কেউ কিছু বলেনি"
      expect(response.body.summary).toMatchObject({ average: null, count: 0 });
    });

    it('shows the review once approved', async () => {
      const review = await prisma.review.findFirstOrThrow({
        where: { productId, rating: 5 },
        select: { id: true },
      });

      await request(app.getHttpServer())
        .patch(`/admin/reviews/${review.id}/moderation`)
        .set(...auth(staffToken))
        .send({ isApproved: true })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`/products/${productSlug}/reviews`)
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({ rating: 5, title: 'Great' });
      expect(response.body.summary).toMatchObject({ average: 5, count: 1 });
    });

    it('never exposes the reviewer email', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products/${productSlug}/reviews`)
        .expect(200);

      expect(JSON.stringify(response.body)).not.toContain(buyerEmail);
    });

    it('averages across approved reviews only', async () => {
      const second = await prisma.review.findFirstOrThrow({
        where: { productId, rating: 4 },
        select: { id: true },
      });

      await request(app.getHttpServer())
        .patch(`/admin/reviews/${second.id}/moderation`)
        .set(...auth(staffToken))
        .send({ isApproved: true })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`/products/${productSlug}/reviews`)
        .expect(200);

      expect(response.body.summary).toMatchObject({ average: 4.5, count: 2 });
      expect(response.body.summary.breakdown).toMatchObject({ '4': 1, '5': 1 });
    });

    it('drops the average back when a review is unapproved', async () => {
      const five = await prisma.review.findFirstOrThrow({
        where: { productId, rating: 5 },
        select: { id: true },
      });

      await request(app.getHttpServer())
        .patch(`/admin/reviews/${five.id}/moderation`)
        .set(...auth(staffToken))
        .send({ isApproved: false })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`/products/${productSlug}/reviews`)
        .expect(200);

      // জমানো গড় হলে এখানে ৪.৫ রয়ে যেত — এজন্যই হিসাব করে নেওয়া হয়
      expect(response.body.summary).toMatchObject({ average: 4, count: 1 });

      await request(app.getHttpServer())
        .patch(`/admin/reviews/${five.id}/moderation`)
        .set(...auth(staffToken))
        .send({ isApproved: true })
        .expect(200);
    });

    it('carries the rating into the product detail page', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products/${productSlug}`)
        .expect(200);

      expect(response.body.rating).toMatchObject({ average: 4.5, count: 2 });
    });

    it('carries the rating into the product list', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products?categorySlug=reviewed-${stamp}`)
        .expect(200);

      const ours = (response.body.items as { slug: string; rating: unknown }[]).find(
        (item) => item.slug === productSlug,
      );

      expect(ours?.rating).toMatchObject({ average: 4.5, count: 2 });
    });

    it('carries the rating into search results too', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products/search?q=${encodeURIComponent('Reviewable')}`)
        .expect(200);

      const ours = (response.body.items as { slug: string; rating: unknown }[]).find(
        (item) => item.slug === productSlug,
      );

      // তালিকা আর সার্চ একই কার্ড দেখায় — একটায় তারা থাকলে অন্যটায়ও থাকা দরকার
      expect(ours?.rating).toMatchObject({ average: 4.5, count: 2 });
    });

    it('filters by a star count when asked', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products/${productSlug}/reviews?rating=4`)
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({ rating: 4 });
    });
  });

  describe('the shop answering back', () => {
    it('lets an admin reply to a review', async () => {
      const review = await prisma.review.findFirstOrThrow({
        where: { productId, rating: 4 },
        select: { id: true },
      });

      const response = await request(app.getHttpServer())
        .patch(`/admin/reviews/${review.id}/reply`)
        .set(...auth(staffToken))
        .send({ adminReply: 'ধন্যবাদ, পরের বার আরও ভালো করব' })
        .expect(200);

      expect(response.body.adminReply).toContain('ধন্যবাদ');
      expect(response.body.adminReplyAt).not.toBeNull();
    });

    it('shows the reply to the public', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products/${productSlug}/reviews?rating=4`)
        .expect(200);

      expect(response.body.items[0].adminReply).toContain('ধন্যবাদ');
    });

    it('keeps customers out of replying', async () => {
      const review = await prisma.review.findFirstOrThrow({
        where: { productId, rating: 4 },
        select: { id: true },
      });

      await request(app.getHttpServer())
        .patch(`/admin/reviews/${review.id}/reply`)
        .set(...auth(buyerToken))
        .send({ adminReply: 'I am not the shop' })
        .expect(403);
    });

    it('keeps customers out of moderation', async () => {
      const review = await prisma.review.findFirstOrThrow({
        where: { productId, rating: 4 },
        select: { id: true },
      });

      await request(app.getHttpServer())
        .patch(`/admin/reviews/${review.id}/moderation`)
        .set(...auth(buyerToken))
        .send({ isApproved: true })
        .expect(403);
    });

    it('clears a reply when sent null', async () => {
      const review = await prisma.review.findFirstOrThrow({
        where: { productId, rating: 4 },
        select: { id: true },
      });

      const response = await request(app.getHttpServer())
        .patch(`/admin/reviews/${review.id}/reply`)
        .set(...auth(staffToken))
        .send({ adminReply: null })
        .expect(200);

      expect(response.body.adminReply).toBeNull();
      expect(response.body.adminReplyAt).toBeNull();
    });
  });

  describe("the admin's queue", () => {
    it('shows reviews waiting for approval by default', async () => {
      const pending = await prisma.review.findFirst({
        where: { productId, isApproved: false },
        select: { id: true },
      });

      // এই মুহূর্তে সব অনুমোদিত, তাই সারিটা আমাদের পণ্যের জন্য খালি
      const response = await request(app.getHttpServer())
        .get('/admin/reviews')
        .set(...auth(staffToken))
        .expect(200);

      const ours = (response.body.items as { id: string }[]).filter(
        (item) => item.id === pending?.id,
      );

      expect(ours).toHaveLength(pending === null ? 0 : 1);
    });

    it('can list approved reviews instead', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/reviews?status=approved')
        .set(...auth(staffToken))
        .expect(200);

      const ours = (response.body.items as { productId: string }[]).filter(
        (item) => item.productId === productId,
      );

      expect(ours.length).toBeGreaterThan(0);
    });

    it('keeps customers out of the queue', async () => {
      await request(app.getHttpServer())
        .get('/admin/reviews')
        .set(...auth(buyerToken))
        .expect(403);
    });
  });

  describe('a customer managing their own review', () => {
    it('lists the reviews the signed-in customer wrote', async () => {
      const response = await request(app.getHttpServer())
        .get('/reviews/mine')
        .set(...auth(buyerToken))
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({ rating: 5 });
    });

    it('lets the author edit their own review', async () => {
      const review = await prisma.review.findFirstOrThrow({
        where: { productId, rating: 5 },
        select: { id: true },
      });

      const response = await request(app.getHttpServer())
        .patch(`/reviews/${review.id}`)
        .set(...auth(buyerToken))
        .send({ rating: 3, body: 'It broke after a week' })
        .expect(200);

      expect(response.body).toMatchObject({ rating: 3 });
    });

    it('sends an edited review back for approval', async () => {
      const review = await prisma.review.findFirstOrThrow({
        where: { productId, rating: 3 },
        select: { isApproved: true },
      });

      // নইলে অনুমোদিত "দারুণ!" সম্পাদনা করে গালি বসিয়ে দেওয়া যেত
      expect(review.isApproved).toBe(false);
    });

    it('refuses to let one customer edit another customer review', async () => {
      const review = await prisma.review.findFirstOrThrow({
        where: { productId, rating: 4 },
        select: { id: true },
      });

      await request(app.getHttpServer())
        .patch(`/reviews/${review.id}`)
        .set(...auth(buyerToken))
        .send({ rating: 1 })
        .expect(403);
    });

    it('lets the author delete their own review', async () => {
      const review = await prisma.review.findFirstOrThrow({
        where: { productId, rating: 3 },
        select: { id: true },
      });

      await request(app.getHttpServer())
        .delete(`/reviews/${review.id}`)
        .set(...auth(buyerToken))
        .expect(204);

      const gone = await prisma.review.findUnique({ where: { id: review.id } });
      expect(gone).toBeNull();
    });

    it('frees the purchase to be reviewed again after a delete', async () => {
      // একটাই রিভিউ, কিন্তু মন বদলানোর অধিকার থাকা উচিত
      const response = await request(app.getHttpServer())
        .post('/reviews')
        .set(...auth(buyerToken))
        .send({ orderItemId: deliveredItemId, rating: 4, body: 'Second thoughts' })
        .expect(201);

      expect(response.body).toMatchObject({ rating: 4 });
    });
  });
});
