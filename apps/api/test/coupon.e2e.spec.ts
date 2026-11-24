import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * কুপন — যাচাই, চেকআউটে প্রয়োগ, আর অ্যাডমিনের নিয়ন্ত্রণ।
 *
 * **এখানে ভুলের দাম সরাসরি টাকায়।** ছাড় ক্লায়েন্ট থেকে নেওয়া গেলে
 * যে কেউ নিজের দাম নিজে ঠিক করত; সীমা ফাঁকি দেওয়া গেলে একটা কুপন
 * দিয়েই পুরো ক্যাম্পেইন খেয়ে ফেলা যেত। তাই প্রতিটা সীমা আলাদা করে
 * আসল HTTP request দিয়ে যাচাই করা হয়।
 */
describe('Coupons', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const adminEmail = `cp-admin-${stamp}@test.local`;
  const buyerEmail = `cp-buyer-${stamp}@test.local`;
  const otherEmail = `cp-other-${stamp}@test.local`;
  const password = 'secret123';

  let adminToken = '';
  let buyerToken = '';
  let otherToken = '';

  const categorySlug = `cp-cat-${stamp}`;
  const productSlug = `cp-shirt-${stamp}`;

  /** ৫০০ টাকা */
  const UNIT_PRICE_PAISA = 50_000;

  let variantId = '';

  /** টেস্টের তৈরি কুপন — শেষে মুছে ফেলা হয়। */
  const createdCouponIds: string[] = [];

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  /** বাংলাদেশি ১১ ডিজিটের নম্বর, প্রতি ডাকে আলাদা। */
  let phoneSlot = 0;
  const nextPhone = (): string => {
    phoneSlot += 1;
    return `017${String(stamp % 100_000_000).padStart(8, '0').slice(0, 6)}${String(phoneSlot).padStart(2, '0')}`;
  };

  const address = () => ({
    fullName: 'Coupon Buyer',
    phone: nextPhone(),
    line1: 'House 7, Road 3',
    city: 'Dhaka',
    district: 'Dhaka',
  });

  const makeCoupon = async (
    body: Record<string, unknown>,
    expectStatus = 201,
  ): Promise<{ status: number; body: Record<string, string> }> => {
    const response = await request(app.getHttpServer())
      .post('/admin/coupons')
      .set(authed(adminToken))
      .send(body)
      .expect(expectStatus);

    if (response.status === 201 && typeof response.body.id === 'string') {
      createdCouponIds.push(response.body.id);
    }

    return response;
  };

  /** কার্টে একটা পণ্য বসায়। */
  const fillCart = async (token: string, quantity = 1): Promise<void> => {
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(authed(token))
      .send({ variantId, quantity })
      .expect(201);
  };

  const checkout = async (
    token: string,
    body: Record<string, unknown> = {},
  ): Promise<{ status: number; body: Record<string, number | string> }> =>
    request(app.getHttpServer())
      .post('/orders')
      .set(authed(token))
      .send({ address: address(), ...body });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: adminEmail, password, name: 'Coupon Admin' })
      .expect(201);

    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'SUPER_ADMIN' } });

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = adminLogin.body.accessToken;

    const buyer = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: buyerEmail, password, name: 'Coupon Buyer' })
      .expect(201);
    buyerToken = buyer.body.accessToken;

    const other = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: otherEmail, password, name: 'Other Buyer' })
      .expect(201);
    otherToken = other.body.accessToken;

    const category = await request(app.getHttpServer())
      .post('/admin/categories')
      .set(authed(adminToken))
      .send({ name: 'Coupon Cat', slug: categorySlug })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/admin/products')
      .set(authed(adminToken))
      .send({
        name: 'Coupon Shirt',
        slug: productSlug,
        categoryId: category.body.id,
        isPublished: true,
        variants: [{ sku: `SKU-CP-${stamp}`, pricePaisa: UNIT_PRICE_PAISA, stock: 500 }],
      })
      .expect(201);

    variantId = product.body.variants[0].id;
  });

  afterAll(async () => {
    const emails = [adminEmail, buyerEmail, otherEmail];
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    /**
     * ক্রম গুরুত্বপূর্ণ। `Order.user`-এ cascade নেই (ইচ্ছাকৃত — অর্ডার
     * ব্যবসার হিসাব, ইউজার মুছলেও হারানো চলবে না), তাই আগে অর্ডার
     * মুছতে হয়। redemption অর্ডারের সাথে cascade-এ যায়।
     */
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.coupon.deleteMany({ where: { id: { in: createdCouponIds } } });
    await prisma.product.deleteMany({ where: { slug: productSlug } });
    await prisma.category.deleteMany({ where: { slug: categorySlug } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  describe('who may manage coupons', () => {
    /** কুপন সরাসরি টাকা ছাড়ের সিদ্ধান্ত — শুধু মালিক। */
    it('keeps a customer out of the admin endpoints', async () => {
      await request(app.getHttpServer())
        .get('/admin/coupons')
        .set(authed(buyerToken))
        .expect(403);
    });

    it('refuses an anonymous caller', async () => {
      await request(app.getHttpServer()).get('/admin/coupons').expect(401);
    });

    /** যাচাইয়েও লগইন লাগে — প্রতি-ইউজার সীমা গুনতে হয়। */
    it('needs a login to validate a code', async () => {
      await request(app.getHttpServer())
        .post('/coupons/validate')
        .send({ code: 'ANYTHING', subtotalPaisa: 50_000 })
        .expect(401);
    });
  });

  describe('creating coupons', () => {
    it('stores the code in upper case whatever the admin typed', async () => {
      const response = await makeCoupon({
        code: `lower${stamp}`,
        type: 'FIXED',
        value: 5_000,
      });

      expect(response.body.code).toBe(`LOWER${stamp}`);
    });

    it('refuses a duplicate code', async () => {
      const code = `DUP${stamp}`;

      await makeCoupon({ code, type: 'FIXED', value: 5_000 });
      await makeCoupon({ code, type: 'FIXED', value: 9_000 }, 409);
    });

    /** `PERCENT 0` এমন কুপন বানাত যা কোনো ছাড়ই দেয় না। */
    it('refuses a percentage of zero', async () => {
      await makeCoupon({ code: `ZERO${stamp}`, type: 'PERCENT', value: 0 }, 400);
    });

    it('refuses a percentage above 100', async () => {
      await makeCoupon({ code: `HUGE${stamp}`, type: 'PERCENT', value: 150 }, 400);
    });

    /** সীমা শুধু শতাংশে অর্থবহ — নইলে অ্যাডমিন ভাবত এটা কাজ করছে। */
    it('refuses a max-discount cap on a fixed coupon', async () => {
      await makeCoupon(
        { code: `CAP${stamp}`, type: 'FIXED', value: 5_000, maxDiscountPaisa: 1_000 },
        400,
      );
    });

    it('refuses an end date before the start', async () => {
      await makeCoupon(
        {
          code: `BACK${stamp}`,
          type: 'FIXED',
          value: 5_000,
          startsAt: '2026-08-01T00:00:00.000Z',
          endsAt: '2026-07-01T00:00:00.000Z',
        },
        400,
      );
    });

    it('refuses a code with spaces', async () => {
      await makeCoupon({ code: 'BAD CODE', type: 'FIXED', value: 5_000 }, 400);
    });
  });

  describe('validating a code in the cart', () => {
    it('reports an unknown code without an error status', async () => {
      const response = await request(app.getHttpServer())
        .post('/coupons/validate')
        .set(authed(buyerToken))
        .send({ code: `NOPE${stamp}`, subtotalPaisa: 50_000 })
        .expect(200);

      expect(response.body.ok).toBe(false);
      expect(response.body.discountPaisa).toBe(0);
      expect(response.body.message).toBeTruthy();
    });

    it('works whatever case the customer typed', async () => {
      const code = `CASE${stamp}`;

      await makeCoupon({ code, type: 'FIXED', value: 7_000 });

      const response = await request(app.getHttpServer())
        .post('/coupons/validate')
        .set(authed(buyerToken))
        .send({ code: code.toLowerCase(), subtotalPaisa: 50_000 })
        .expect(200);

      expect(response.body.ok).toBe(true);
      expect(response.body.discountPaisa).toBe(7_000);
    });

    /** কত টাকা কম পড়ল — কার্টে "আর ৩০০ টাকার কিনুন" দেখানোর জন্য। */
    it('says how much more is needed below the minimum', async () => {
      const code = `MIN${stamp}`;

      await makeCoupon({ code, type: 'FIXED', value: 5_000, minOrderPaisa: 80_000 });

      const response = await request(app.getHttpServer())
        .post('/coupons/validate')
        .set(authed(buyerToken))
        .send({ code, subtotalPaisa: 50_000 })
        .expect(200);

      expect(response.body.ok).toBe(false);
      expect(response.body.shortfallPaisa).toBe(30_000);
    });

    it('reports an expired coupon', async () => {
      const code = `OLD${stamp}`;

      await makeCoupon({
        code,
        type: 'FIXED',
        value: 5_000,
        endsAt: '2020-01-01T00:00:00.000Z',
      });

      const response = await request(app.getHttpServer())
        .post('/coupons/validate')
        .set(authed(buyerToken))
        .send({ code, subtotalPaisa: 50_000 })
        .expect(200);

      expect(response.body.ok).toBe(false);
    });

    /** যাচাই কিছুই সংরক্ষণ করে না — বারবার দেখলেও কুপন ফুরোয় না। */
    it('does not consume the coupon', async () => {
      const code = `PEEK${stamp}`;
      const created = await makeCoupon({ code, type: 'FIXED', value: 5_000, maxUses: 1 });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await request(app.getHttpServer())
          .post('/coupons/validate')
          .set(authed(buyerToken))
          .send({ code, subtotalPaisa: 50_000 })
          .expect(200);
      }

      const uses = await prisma.couponRedemption.count({
        where: { couponId: created.body.id },
      });

      expect(uses).toBe(0);
    });
  });

  describe('applying a coupon at checkout', () => {
    it('takes a fixed amount off the total', async () => {
      const code = `FIX${stamp}`;

      await makeCoupon({ code, type: 'FIXED', value: 10_000 });
      await fillCart(buyerToken);

      const response = await checkout(buyerToken, { couponCode: code });

      expect(response.status).toBe(201);
      expect(response.body.subtotalPaisa).toBe(UNIT_PRICE_PAISA);
      expect(response.body.discountPaisa).toBe(10_000);

      const { subtotalPaisa, shippingPaisa, discountPaisa, shippingDiscountPaisa, totalPaisa } =
        response.body as Record<string, number>;

      expect(totalPaisa).toBe(subtotalPaisa + shippingPaisa - discountPaisa - shippingDiscountPaisa);
    });

    it('takes a percentage off', async () => {
      const code = `PCT${stamp}`;

      await makeCoupon({ code, type: 'PERCENT', value: 10 });
      await fillCart(buyerToken);

      const response = await checkout(buyerToken, { couponCode: code });

      expect(response.status).toBe(201);
      // ৫০০ টাকার ১০% = ৫০ টাকা
      expect(response.body.discountPaisa).toBe(5_000);
    });

    /**
     * ফ্রি শিপিং **ডেলিভারিতে** ছাড় দেয়, পণ্যে নয় — আলাদা মাঠে।
     * মিশিয়ে দিলে ইনভয়েসে "ডেলিভারি ১২০৳" আর "ছাড় ১২০৳" দুটোই
     * দেখাত, আর কুরিয়ারের বিল মেলানো কঠিন হতো।
     */
    it('waives the delivery charge with a free-shipping coupon', async () => {
      const code = `SHIP${stamp}`;

      await makeCoupon({ code, type: 'FREE_SHIPPING', value: 0 });
      await fillCart(buyerToken);

      const response = await checkout(buyerToken, { couponCode: code });

      expect(response.status).toBe(201);
      expect(response.body.discountPaisa).toBe(0);

      const { shippingPaisa, shippingDiscountPaisa, totalPaisa, subtotalPaisa } =
        response.body as Record<string, number>;

      expect(shippingDiscountPaisa).toBe(shippingPaisa);
      // ডেলিভারি কার্যত ফ্রি — মোট শুধু পণ্যের দাম
      expect(totalPaisa).toBe(subtotalPaisa);
    });

    /**
     * **সবচেয়ে দামি সুরক্ষা।** ছাড় মোটের চেয়ে বড় হলে total
     * ঋণাত্মক হতো — দোকান ক্রেতাকে টাকা ফেরত দিত।
     */
    it('never lets the total go below zero', async () => {
      const code = `BIG${stamp}`;

      await makeCoupon({ code, type: 'FIXED', value: 2_000_000 });
      await fillCart(buyerToken);

      const response = await checkout(buyerToken, { couponCode: code });

      expect(response.status).toBe(201);
      expect(response.body.discountPaisa).toBe(UNIT_PRICE_PAISA);
      expect(Number(response.body.totalPaisa)).toBeGreaterThanOrEqual(0);
    });

    /**
     * **ছাড় কখনো ইনপুট থেকে নয়।** ক্রেতা `discountPaisa` পাঠালে
     * সেটা উপেক্ষা হতে হবে, নইলে যে কেউ নিজের দাম নিজে ঠিক করত।
     */
    it('ignores a discount the client tries to send', async () => {
      await fillCart(buyerToken);

      const response = await checkout(buyerToken, { discountPaisa: 49_000 });

      expect(response.status).toBe(201);
      expect(response.body.discountPaisa).toBe(0);
      expect(response.body.totalPaisa).toBe(
        Number(response.body.subtotalPaisa) + Number(response.body.shippingPaisa),
      );
    });

    it('refuses an order with an unknown code', async () => {
      await fillCart(buyerToken);

      const response = await checkout(buyerToken, { couponCode: `GHOST${stamp}` });

      expect(response.status).toBe(400);
    });

    /** কুপন ব্যর্থ হলে অর্ডারই হবে না — কার্ট অটুট থাকতে হবে। */
    it('leaves the cart alone when the coupon fails', async () => {
      await fillCart(buyerToken);

      await checkout(buyerToken, { couponCode: `GHOST2${stamp}` }).then((response) => {
        expect(response.status).toBe(400);
      });

      const cart = await prisma.cart.findFirst({
        where: { user: { email: buyerEmail } },
        include: { items: true },
      });

      expect(cart?.items.length).toBeGreaterThan(0);

      // পরের টেস্টের জন্য কার্ট খালি করা
      await prisma.cartItem.deleteMany({ where: { cartId: cart?.id } });
    });

    it('records who used the coupon and how much they saved', async () => {
      const code = `TRACK${stamp}`;
      const created = await makeCoupon({ code, type: 'FIXED', value: 6_000 });

      await fillCart(buyerToken);
      await checkout(buyerToken, { couponCode: code }).then((response) => {
        expect(response.status).toBe(201);
      });

      const redemptions = await prisma.couponRedemption.findMany({
        where: { couponId: created.body.id },
      });

      expect(redemptions).toHaveLength(1);
      expect(redemptions[0]?.discountPaisa).toBe(6_000);
    });
  });

  describe('the use limits hold at checkout', () => {
    it('refuses a second order from the same customer', async () => {
      const code = `ONCE${stamp}`;

      await makeCoupon({ code, type: 'FIXED', value: 5_000, maxUsesPerUser: 1 });

      await fillCart(buyerToken);
      await checkout(buyerToken, { couponCode: code }).then((response) => {
        expect(response.status).toBe(201);
      });

      await fillCart(buyerToken);
      const second = await checkout(buyerToken, { couponCode: code });

      expect(second.status).toBe(400);
    });

    it('still lets a different customer use it', async () => {
      const code = `SHARED${stamp}`;

      await makeCoupon({ code, type: 'FIXED', value: 5_000, maxUsesPerUser: 1 });

      await fillCart(buyerToken);
      await checkout(buyerToken, { couponCode: code }).then((response) => {
        expect(response.status).toBe(201);
      });

      await fillCart(otherToken);
      const other = await checkout(otherToken, { couponCode: code });

      expect(other.status).toBe(201);
    });

    it('refuses an order below the minimum', async () => {
      const code = `FLOOR${stamp}`;

      // কার্টে একটা পণ্য = ৫০০ টাকা, ন্যূনতম ১০০০ টাকা
      await makeCoupon({ code, type: 'FIXED', value: 5_000, minOrderPaisa: 100_000 });
      await fillCart(buyerToken);

      const response = await checkout(buyerToken, { couponCode: code });

      expect(response.status).toBe(400);
    });

    it('refuses an expired coupon at checkout too', async () => {
      const code = `DEAD${stamp}`;

      await makeCoupon({
        code,
        type: 'FIXED',
        value: 5_000,
        endsAt: '2020-01-01T00:00:00.000Z',
      });
      await fillCart(buyerToken);

      const response = await checkout(buyerToken, { couponCode: code });

      expect(response.status).toBe(400);
    });

    /**
     * **15.7 — আসল race।** দুজন একসাথে শেষ কুপনটা নিতে চাইলে
     * **একজনই** পাবে।
     *
     * গোনা আর লেখা একই transaction-এ না হলে দুজনেই পাস করত: দুজনেই
     * `totalUses = 0` পড়ে, দুজনেই ছাড় পেয়ে যেত। এক কুপনে দুবার ছাড়
     * মানে সরাসরি লোকসান।
     */
    it('gives the last remaining coupon to exactly one of two racing orders', async () => {
      const code = `RACE${stamp}`;

      const created = await makeCoupon({
        code,
        type: 'FIXED',
        value: 5_000,
        maxUses: 1,
        // দুজন আলাদা ক্রেতা, তাই প্রতি-ইউজার সীমা এখানে বাধা নয়
        maxUsesPerUser: 1,
      });

      await fillCart(buyerToken);
      await fillCart(otherToken);

      const [first, second] = await Promise.all([
        checkout(buyerToken, { couponCode: code }),
        checkout(otherToken, { couponCode: code }),
      ]);

      const statuses = [first.status, second.status].sort((a, b) => a - b);

      // একটা সফল, একটা প্রত্যাখ্যাত — দুটোই সফল হলে টাকা যেত
      expect(statuses).toEqual([201, 400]);

      const uses = await prisma.couponRedemption.count({
        where: { couponId: created.body.id },
      });

      expect(uses).toBe(1);
    });
  });

  describe('admin control and reporting', () => {
    it('switches a coupon off without touching anything else', async () => {
      const code = `OFF${stamp}`;
      const created = await makeCoupon({
        code,
        type: 'FIXED',
        value: 5_000,
        minOrderPaisa: 20_000,
        maxUses: 50,
      });

      await request(app.getHttpServer())
        .patch(`/admin/coupons/${created.body.id}`)
        .set(authed(adminToken))
        .send({ isActive: false })
        .expect(200);

      const saved = await prisma.coupon.findUniqueOrThrow({ where: { id: created.body.id } });

      expect(saved.isActive).toBe(false);
      /**
       * বাকি মাঠ অপরিবর্তিত — Phase 14-এ শিপিং zone-এ ঠিক এই বাগটা
       * ধরা পড়েছিল: `.partial()` দিয়ে schema বানালে `.default()`
       * থেকে যেত আর না-পাঠানো মাঠগুলো মুছে যেত।
       */
      expect(saved.minOrderPaisa).toBe(20_000);
      expect(saved.maxUses).toBe(50);
      expect(saved.value).toBe(5_000);
    });

    it('stops working once switched off', async () => {
      const code = `STOP${stamp}`;
      const created = await makeCoupon({ code, type: 'FIXED', value: 5_000 });

      await request(app.getHttpServer())
        .patch(`/admin/coupons/${created.body.id}`)
        .set(authed(adminToken))
        .send({ isActive: false })
        .expect(200);

      await fillCart(buyerToken);
      const response = await checkout(buyerToken, { couponCode: code });

      expect(response.status).toBe(400);
    });

    it('reports how often a coupon ran and what it cost', async () => {
      const code = `REPORT${stamp}`;
      const created = await makeCoupon({ code, type: 'FIXED', value: 8_000 });

      await fillCart(buyerToken);
      await checkout(buyerToken, { couponCode: code }).then((response) => {
        expect(response.status).toBe(201);
      });

      const report = await request(app.getHttpServer())
        .get(`/admin/coupons/${created.body.id}/usage`)
        .set(authed(adminToken))
        .expect(200);

      expect(report.body.totalUses).toBe(1);
      expect(report.body.discountGivenPaisa).toBe(8_000);
    });

    /**
     * ব্যবহার হয়ে যাওয়া কুপন মোছা গেলে `CouponRedemption` cascade-এ
     * চলে যেত আর পুরোনো অর্ডারে কোন কুপনে ছাড় দেওয়া হয়েছিল তার
     * হিসাব হারিয়ে যেত।
     */
    it('refuses to delete a coupon that has been used', async () => {
      const code = `KEEP${stamp}`;
      const created = await makeCoupon({ code, type: 'FIXED', value: 5_000 });

      await fillCart(buyerToken);
      await checkout(buyerToken, { couponCode: code }).then((response) => {
        expect(response.status).toBe(201);
      });

      await request(app.getHttpServer())
        .delete(`/admin/coupons/${created.body.id}`)
        .set(authed(adminToken))
        .expect(400);
    });

    it('deletes one that nobody used', async () => {
      const code = `UNUSED${stamp}`;
      const created = await makeCoupon({ code, type: 'FIXED', value: 5_000 });

      await request(app.getHttpServer())
        .delete(`/admin/coupons/${created.body.id}`)
        .set(authed(adminToken))
        .expect(204);
    });
  });
});
