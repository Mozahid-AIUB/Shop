import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * COD ঝুঁকির হিসাব, আসল DB-তে।
 *
 * **এই suite-এর মূল কথা: ঝুঁকি যত বেশিই হোক, অর্ডার সফল হবে।**
 * সিস্টেম কখনো নিজে "না" বলে না — শুধু অ্যাডমিনকে দেখে নিতে বলে।
 */
describe('Fraud guard', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const adminEmail = `fg-admin-${stamp}@test.local`;
  const goodEmail = `fg-good-${stamp}@test.local`;
  const riskyEmail = `fg-risky-${stamp}@test.local`;
  const password = 'secret123';

  let adminToken = '';
  let goodToken = '';
  let riskyToken = '';

  const categorySlug = `fg-cat-${stamp}`;
  const productSlug = `fg-item-${stamp}`;
  const UNIT_PRICE_PAISA = 60_000;

  let variantId = '';

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  /**
   * আলাদা আলাদা ফোন নম্বর — ঝুঁকি ফোন ধরেও গোনা হয়, তাই এক টেস্টের
   * অর্ডার অন্য টেস্টের স্কোরে যেন না ঢোকে।
   * বাংলাদেশি নম্বর **ঠিক ১১ সংখ্যা**, তাই প্যাড করা হয়।
   */
  const phoneFor = (slot: number): string =>
    `01${slot}${String(stamp % 100_000_000).padStart(8, '0')}`.slice(0, 11);

  const makeUser = async (email: string, role?: string): Promise<string> => {
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Fraud Test' })
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

  /** একটা অর্ডার দেয়। ফোন আলাদা করা যায়, কারণ ঝুঁকি ফোনেও গোনা হয়। */
  const placeOrder = async (
    token: string,
    options: { phone?: string; quantity?: number; line1?: string } = {},
  ): Promise<string> => {
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(authed(token))
      .send({ variantId, quantity: options.quantity ?? 1 })
      .expect(201);

    const order = await request(app.getHttpServer())
      .post('/orders')
      .set(authed(token))
      .send({
        address: {
          fullName: 'Fraud Test Buyer',
          phone: options.phone ?? '01712345678',
          line1: options.line1 ?? 'House 11, Road 6',
          city: 'Dhanmondi',
          district: 'Dhaka',
        },
      })
      .expect(201);

    return order.body.orderNumber;
  };

  const fraudCheckFor = async (
    orderNumber: string,
  ): Promise<{ score: number; level: string } | null> => {
    const order = await prisma.order.findUnique({
      where: { orderNumber },
      select: { fraudCheck: { select: { score: true, level: true } } },
    });

    return order?.fraudCheck ?? null;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    adminToken = await makeUser(adminEmail, 'SUPER_ADMIN');
    goodToken = await makeUser(goodEmail);
    riskyToken = await makeUser(riskyEmail);

    const category = await request(app.getHttpServer())
      .post('/admin/categories')
      .set(authed(adminToken))
      .send({ name: 'Fraud Cat', slug: categorySlug })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/admin/products')
      .set(authed(adminToken))
      .send({
        name: 'Fraud Item',
        slug: productSlug,
        categoryId: category.body.id,
        isPublished: true,
        variants: [{ sku: `SKU-FG-${stamp}`, pricePaisa: UNIT_PRICE_PAISA, stock: 200 }],
      })
      .expect(201);

    variantId = product.body.variants[0].id;
  });

  afterAll(async () => {
    const emails = [adminEmail, goodEmail, riskyEmail];
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    await prisma.activityLog.deleteMany({ where: { actorId: { in: userIds } } });
    // FraudCheck cascade-এ অর্ডারের সাথেই মুছবে
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.product.deleteMany({ where: { slug: productSlug } });
    await prisma.category.deleteMany({ where: { slug: categorySlug } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  describe('every order gets assessed', () => {
    it('stores a score alongside the order', async () => {
      const orderNumber = await placeOrder(goodToken, { phone: phoneFor(7) });

      const check = await fraudCheckFor(orderNumber);

      expect(check).not.toBeNull();
      expect(check?.level).toBeDefined();
    });

    /** নতুন কাস্টমারের ছোট অর্ডার সন্দেহজনক নয় — এটাই অধিকাংশ অর্ডার। */
    it('leaves an ordinary first order alone', async () => {
      const orderNumber = await placeOrder(goodToken, { phone: phoneFor(8) });

      const check = await fraudCheckFor(orderNumber);

      expect(check?.level).toBe('LOW');
      expect(check?.score).toBe(0);
    });
  });

  describe('a risky order is flagged but never blocked', () => {
    /**
     * **এই suite-এর সবচেয়ে গুরুত্বপূর্ণ টেস্ট।**
     *
     * আগে অর্ডার বাতিল করা কাস্টমার আবার অর্ডার করলে স্কোর বাড়বে,
     * কিন্তু অর্ডারটা হতেই হবে। ব্লক করলে আসল ক্রেতা হারানোর
     * ঝুঁকি, আর সেই ক্ষতি কেউ কখনো টের পায় না।
     */
    it('still creates the order when the score is high', async () => {
      const phone = phoneFor(9);

      // দুটো অর্ডার বাতিল করা হয় — ঝুঁকির সবচেয়ে শক্ত সংকেত
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const toCancel = await placeOrder(riskyToken, { phone });

        await request(app.getHttpServer())
          .post(`/orders/${toCancel}/cancel`)
          .set(authed(riskyToken))
          .send({ reason: 'Changed my mind again' })
          .expect(200);
      }

      // এখন আবার অর্ডার — ২০১ পেতেই হবে, ৪০৩ নয়
      const orderNumber = await placeOrder(riskyToken, { phone });

      const check = await fraudCheckFor(orderNumber);

      expect(check?.level).toBe('HIGH');
      // অর্ডারটা সত্যিই আছে — ফ্ল্যাগ মানে বাধা নয়
      const order = await prisma.order.findUnique({ where: { orderNumber } });
      expect(order).not.toBeNull();
      expect(order?.status).toBe('PENDING');
    });

    /** কারণ ছাড়া স্কোর দেখালে অ্যাডমিন জানবে না কী জিজ্ঞেস করতে হবে। */
    it('records why, not just how much', async () => {
      const order = await prisma.order.findFirst({
        where: { user: { email: riskyEmail }, fraudCheck: { level: 'HIGH' } },
        select: { fraudCheck: { select: { reasons: true } } },
      });

      const reasons = order?.fraudCheck?.reasons;

      expect(Array.isArray(reasons)).toBe(true);
      expect((reasons as unknown[]).length).toBeGreaterThan(0);
    });
  });

  describe('a failed assessment never breaks checkout', () => {
    /**
     * ঝুঁকির হিসাব transaction-এর বাইরে চলে। এখানে সেটা পরোক্ষভাবে
     * যাচাই হয়: একই অর্ডারে দুবার হিসাব করার চেষ্টা করলে
     * `orderId` unique হওয়ায় ব্যর্থ হয়, কিন্তু কিছু ভাঙে না।
     */
    it('swallows a duplicate assessment instead of throwing', async () => {
      const orderNumber = await placeOrder(goodToken, { phone: phoneFor(6) });

      const order = await prisma.order.findUniqueOrThrow({
        where: { orderNumber },
        select: { id: true },
      });

      const fraud = app.get(
        (await import('../src/modules/orders/fraud.service')).FraudService,
      );

      // দ্বিতীয়বার — unique constraint ভাঙবে, কিন্তু throw করবে না
      await expect(fraud.checkOrder(order.id)).resolves.toBeNull();
    });
  });
});
