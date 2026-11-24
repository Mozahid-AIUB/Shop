import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * ব্যবসার রিপোর্ট। আসল DB লাগে।
 *
 * **কেন আগে-পরের পার্থক্য মাপা হয়, নিখুঁত সংখ্যা নয়:** রিপোর্ট পুরো
 * DB-র উপর চলে, তাই অন্য suite-এর অর্ডারও হিসাবে আসে। "মোট ঠিক
 * ২টা অর্ডার" লিখলে টেস্ট অন্য টেস্টের উপর নির্ভরশীল হয়ে পড়ত আর
 * একা চালালে এক ফল, সবার সাথে চালালে আরেক ফল দিত।
 */
describe('Reports', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const adminEmail = `rp-admin-${stamp}@test.local`;
  const managerEmail = `rp-mgr-${stamp}@test.local`;
  const buyerEmail = `rp-buyer-${stamp}@test.local`;
  const password = 'secret123';

  let adminToken = '';
  let managerToken = '';
  let buyerToken = '';

  const categorySlug = `rp-cat-${stamp}`;
  const productSlug = `rp-item-${stamp}`;
  const UNIT_PRICE_PAISA = 50_000; // ৫০০ টাকা
  const QUANTITY = 2;
  const ORDER_TOTAL_PAISA = UNIT_PRICE_PAISA * QUANTITY;

  let variantId = '';
  let paidOrderNumber = '';
  let cancelledOrderNumber = '';

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  /** আজকের দিন — রিপোর্টের ডিফল্ট range-এ পড়বে। */
  const today = ((): string => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
  })();

  const makeUser = async (email: string, role?: string): Promise<string> => {
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Reports Test' })
      .expect(201);

    if (role === undefined) {
      return registered.body.accessToken;
    }

    await prisma.user.update({ where: { email }, data: { role: role as 'SUPER_ADMIN' } });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    return login.body.accessToken;
  };

  /** একটা অর্ডার বানায় আর তার নম্বর ফেরত দেয়। */
  const placeOrder = async (): Promise<string> => {
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(authed(buyerToken))
      .send({ variantId, quantity: QUANTITY })
      .expect(201);

    const order = await request(app.getHttpServer())
      .post('/orders')
      .set(authed(buyerToken))
      .send({
        address: {
          fullName: 'Reports Buyer',
          phone: '01712345678',
          line1: 'House 9, Road 4',
          city: 'Banani',
          district: 'Dhaka',
        },
      })
      .expect(201);

    return order.body.orderNumber;
  };

  const summaryNow = async (): Promise<{
    orderedPaisa: number;
    collectedPaisa: number;
    duePaisa: number;
    orderCount: number;
  }> => {
    const response = await request(app.getHttpServer())
      .get('/admin/reports/summary')
      .set(authed(adminToken))
      .expect(200);

    return response.body;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    adminToken = await makeUser(adminEmail, 'SUPER_ADMIN');
    managerToken = await makeUser(managerEmail, 'ORDER_MANAGER');
    buyerToken = await makeUser(buyerEmail);

    const category = await request(app.getHttpServer())
      .post('/admin/categories')
      .set(authed(adminToken))
      .send({ name: 'Reports Cat', slug: categorySlug })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/admin/products')
      .set(authed(adminToken))
      .send({
        name: 'Reports Item',
        slug: productSlug,
        categoryId: category.body.id,
        isPublished: true,
        variants: [{ sku: `SKU-RP-${stamp}`, pricePaisa: UNIT_PRICE_PAISA, stock: 50 }],
      })
      .expect(201);

    variantId = product.body.variants[0].id;
  });

  afterAll(async () => {
    const emails = [adminEmail, managerEmail, buyerEmail];
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    await prisma.activityLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.product.deleteMany({ where: { slug: productSlug } });
    await prisma.category.deleteMany({ where: { slug: categorySlug } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  describe('access', () => {
    /**
     * আয়, বকেয়া আর ক্রেতার তালিকা ব্যবসার সবচেয়ে সংবেদনশীল তথ্য।
     * ORDER_MANAGER অর্ডার সামলায়, কিন্তু মোট আয় জানার দরকার নেই।
     */
    it('keeps everyone but a super admin out', async () => {
      await request(app.getHttpServer())
        .get('/admin/reports/summary')
        .set(authed(managerToken))
        .expect(403);

      await request(app.getHttpServer())
        .get('/admin/reports/summary')
        .set(authed(buyerToken))
        .expect(403);
    });

    it('refuses an anonymous caller', async () => {
      await request(app.getHttpServer()).get('/admin/reports/summary').expect(401);
    });
  });

  describe('money', () => {
    /**
     * **এই phase-এর আসল পরীক্ষা।** COD-তে অর্ডার হওয়া আর টাকা হাতে
     * আসা এক নয়, তাই তিনটা সংখ্যা আলাদা হতে হবে।
     */
    it('counts an order as ordered but not yet collected', async () => {
      const before = await summaryNow();

      paidOrderNumber = await placeOrder();

      const after = await summaryNow();

      expect(after.orderCount).toBe(before.orderCount + 1);
      expect(after.orderedPaisa).toBe(before.orderedPaisa + ORDER_TOTAL_PAISA);
      // টাকা এখনো আসেনি — শুধু অর্ডার হয়েছে
      expect(after.collectedPaisa).toBe(before.collectedPaisa);
      expect(after.duePaisa).toBe(before.duePaisa + ORDER_TOTAL_PAISA);
    });

    it('moves money from due to collected when payment is recorded', async () => {
      const before = await summaryNow();

      await request(app.getHttpServer())
        .post(`/admin/orders/${paidOrderNumber}/payments`)
        .set(authed(adminToken))
        .send({ amountPaisa: ORDER_TOTAL_PAISA, method: 'COD' })
        .expect(201);

      const after = await summaryNow();

      // অর্ডারের মোট বদলায়নি — শুধু টাকা হাতে এসেছে
      expect(after.orderedPaisa).toBe(before.orderedPaisa);
      expect(after.collectedPaisa).toBe(before.collectedPaisa + ORDER_TOTAL_PAISA);
      expect(after.duePaisa).toBe(before.duePaisa - ORDER_TOTAL_PAISA);
    });

    /**
     * বাতিল অর্ডার বিক্রি নয়। ধরলে আয় ফুলে দেখাতো আর COD-তে
     * বাতিলের হার কম নয় — সিদ্ধান্ত ভুল হতো।
     */
    it('drops a cancelled order out of the money entirely', async () => {
      cancelledOrderNumber = await placeOrder();

      const withOrder = await summaryNow();

      await request(app.getHttpServer())
        .post(`/orders/${cancelledOrderNumber}/cancel`)
        .set(authed(buyerToken))
        .send({ reason: 'Changed my mind about the colour' })
        .expect(200);

      const afterCancel = await summaryNow();

      expect(afterCancel.orderCount).toBe(withOrder.orderCount - 1);
      expect(afterCancel.orderedPaisa).toBe(withOrder.orderedPaisa - ORDER_TOTAL_PAISA);
    });

    it('never reports a negative due', async () => {
      const summary = await summaryNow();

      expect(summary.duePaisa).toBeGreaterThanOrEqual(0);
    });

    it('reports the average order size without dividing by zero', async () => {
      const response = await request(app.getHttpServer())
        // কোনো অর্ডার নেই এমন পুরোনো সময়
        .get('/admin/reports/summary?from=2019-01-01&to=2019-01-31')
        .set(authed(adminToken))
        .expect(200);

      expect(response.body.orderCount).toBe(0);
      expect(response.body.averageOrderPaisa).toBe(0);
      expect(response.body.duePaisa).toBe(0);
    });
  });

  describe('date range', () => {
    it('rejects a backwards range instead of quietly swapping it', async () => {
      await request(app.getHttpServer())
        .get('/admin/reports/summary?from=2026-02-01&to=2026-01-01')
        .set(authed(adminToken))
        .expect(400);
    });

    it('rejects a range longer than the limit', async () => {
      await request(app.getHttpServer())
        .get('/admin/reports/summary?from=2015-01-01&to=2026-01-01')
        .set(authed(adminToken))
        .expect(400);
    });

    /** একটা দিলে অন্যটা ছাড়া "কোন পর্যন্ত" অস্পষ্ট থেকে যায়। */
    it('rejects half a range', async () => {
      await request(app.getHttpServer())
        .get('/admin/reports/summary?from=2026-01-01')
        .set(authed(adminToken))
        .expect(400);
    });

    /**
     * **সহজে হওয়া ভুল:** শেষ দিনটা ০০:০০ ধরলে ওই দিনের সব অর্ডার
     * বাদ পড়ত — "আজকের বিক্রি ০" দেখাতো।
     */
    it('includes orders placed today when today is the last day', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/reports/summary?from=${today}&to=${today}`)
        .set(authed(adminToken))
        .expect(200);

      expect(response.body.orderCount).toBeGreaterThan(0);
      expect(response.body.orderedPaisa).toBeGreaterThan(0);
    });

    it('echoes back the range it used', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/reports/summary?from=${today}&to=${today}`)
        .set(authed(adminToken))
        .expect(200);

      expect(response.body.from).toBe(today);
      expect(response.body.to).toBe(today);
    });
  });

  describe('best sellers', () => {
    it('lists what actually sold, with quantity and money', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/reports/best-sellers?limit=50')
        .set(authed(adminToken))
        .expect(200);

      const ours = response.body.find(
        (row: { variantSku: string }) => row.variantSku === `SKU-RP-${stamp}`,
      );

      expect(ours).toBeDefined();
      // একটা অর্ডার গোনায় আছে, বাতিলটা নেই
      expect(ours.quantitySold).toBe(QUANTITY);
      expect(ours.revenuePaisa).toBe(ORDER_TOTAL_PAISA);
      expect(ours.productName).toBe('Reports Item');
    });

    it('refuses an unbounded limit', async () => {
      await request(app.getHttpServer())
        .get('/admin/reports/best-sellers?limit=99999')
        .set(authed(adminToken))
        .expect(400);
    });
  });

  describe('status breakdown', () => {
    /**
     * এটাই কার্যত কাজের তালিকা — কোন ধাপে কত অর্ডার আটকে আছে।
     * এখানে বাতিলও দেখানো হয়: কত অর্ডার হারাচ্ছি সেটা জানা দরকার।
     */
    it('shows cancelled orders here even though money ignores them', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/reports/status-breakdown')
        .set(authed(adminToken))
        .expect(200);

      const statuses = response.body.map((row: { status: string }) => row.status);

      expect(statuses).toContain('PENDING');
      expect(statuses).toContain('CANCELLED');
    });
  });

  describe('daily sales', () => {
    it('returns one row per day with orders', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/reports/sales?from=${today}&to=${today}`)
        .set(authed(adminToken))
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      /**
       * প্রথম সারি ধরা যায় না। range-এর সীমানা সার্ভারের ঘড়ি ধরে
       * গোনা হয়, কিন্তু দিন ভাগ হয় ঢাকার সময়ে — তাই UTC মেশিনে
       * আগের দিনের একটা সারিও জানালার ভেতরে পড়তে পারে।
       * আজকের সারিটাই খুঁজে নেওয়া হয়।
       */
      const point = response.body.find((row: { date: string }) => row.date === today);

      expect(point).toBeDefined();
      expect(point.orderCount).toBeGreaterThan(0);
      expect(point.orderedPaisa).toBeGreaterThan(0);
    });
  });

  describe('repeat customers', () => {
    /** আমাদের ক্রেতা দুটো অর্ডার করেছে (একটা বাতিল), তাই এখন একটাই গোনায়। */
    it('only lists customers with more than one live order', async () => {
      // দ্বিতীয় একটা জীবিত অর্ডার — এখন সে সত্যিই repeat customer
      await placeOrder();

      const response = await request(app.getHttpServer())
        .get('/admin/reports/repeat-customers?limit=50')
        .set(authed(adminToken))
        .expect(200);

      const ours = response.body.find(
        (row: { email: string }) => row.email === buyerEmail,
      );

      expect(ours).toBeDefined();
      expect(ours.orderCount).toBe(2);
      expect(ours.totalSpentPaisa).toBe(ORDER_TOTAL_PAISA * 2);
    });
  });
});
