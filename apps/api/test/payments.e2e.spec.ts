import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * পেমেন্ট — কে লিখতে পারে, due কীভাবে হিসাব হয়, void-এ কী হয়।
 * আসল DB লাগে।
 */
describe('Payments', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const adminEmail = `pay-admin-${stamp}@test.local`;
  const accountantEmail = `pay-acct-${stamp}@test.local`;
  const designerEmail = `pay-design-${stamp}@test.local`;
  const buyerEmail = `pay-buyer-${stamp}@test.local`;
  const otherEmail = `pay-other-${stamp}@test.local`;
  const password = 'secret123';

  let adminToken = '';
  let accountantToken = '';
  let designerToken = '';
  let buyerToken = '';
  let otherToken = '';

  const categorySlug = `pay-cat-${stamp}`;
  const productSlug = `pay-item-${stamp}`;

  /** ১০০০ টাকা — হিসাব মেলানো সহজ */
  const UNIT_PRICE_PAISA = 100_000;

  let orderNumber = '';
  let orderTotalPaisa = 0;

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  /** একটা ইউজার বানিয়ে টোকেন ফেরত দেয়, দরকার হলে role বদলে। */
  const makeUser = async (email: string, role?: string): Promise<string> => {
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Payment Test' })
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    adminToken = await makeUser(adminEmail, 'SUPER_ADMIN');
    accountantToken = await makeUser(accountantEmail, 'ACCOUNTANT');
    designerToken = await makeUser(designerEmail, 'DESIGNER');
    buyerToken = await makeUser(buyerEmail);
    otherToken = await makeUser(otherEmail);

    const category = await request(app.getHttpServer())
      .post('/admin/categories')
      .set(authed(adminToken))
      .send({ name: 'Payment Cat', slug: categorySlug })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/admin/products')
      .set(authed(adminToken))
      .send({
        name: 'Payment Item',
        slug: productSlug,
        categoryId: category.body.id,
        isPublished: true,
        variants: [{ sku: `SKU-PAY-${stamp}`, pricePaisa: UNIT_PRICE_PAISA, stock: 50 }],
      })
      .expect(201);

    // একটা অর্ডার বানাই — পেমেন্ট এটার উপরেই বসবে
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(authed(buyerToken))
      .send({ variantId: product.body.variants[0].id, quantity: 1 })
      .expect(201);

    const order = await request(app.getHttpServer())
      .post('/orders')
      .set(authed(buyerToken))
      .send({
        address: {
          fullName: 'Payment Buyer',
          phone: '01712345678',
          line1: 'House 1, Road 1',
          city: 'Mirpur',
          district: 'Dhaka',
        },
      })
      .expect(201);

    orderNumber = order.body.orderNumber;
    orderTotalPaisa = order.body.totalPaisa;
  });

  afterAll(async () => {
    const emails = [adminEmail, accountantEmail, designerEmail, buyerEmail, otherEmail];
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    // Payment cascade-এ অর্ডারের সাথেই মুছবে
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.product.deleteMany({ where: { slug: productSlug } });
    await prisma.category.deleteMany({ where: { slug: categorySlug } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  describe('who may record a payment', () => {
    it('refuses a customer', async () => {
      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/payments`)
        .set(authed(buyerToken))
        .send({ amountPaisa: 10_000, method: 'CASH' })
        .expect(403);
    });

    /** ডিজাইনারের কাজ ছাপা, টাকার হিসাবে নয়। */
    it('refuses a designer', async () => {
      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/payments`)
        .set(authed(designerToken))
        .send({ amountPaisa: 10_000, method: 'CASH' })
        .expect(403);
    });

    it('refuses an anonymous caller', async () => {
      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/payments`)
        .send({ amountPaisa: 10_000, method: 'CASH' })
        .expect(401);
    });
  });

  describe('recording', () => {
    it('starts the order unpaid with the whole amount due', async () => {
      const response = await request(app.getHttpServer())
        .get(`/orders/${orderNumber}/payments`)
        .set(authed(buyerToken))
        .expect(200);

      expect(response.body).toMatchObject({
        totalPaisa: orderTotalPaisa,
        paidPaisa: 0,
        duePaisa: orderTotalPaisa,
        status: 'UNPAID',
      });
      expect(response.body.payments).toEqual([]);
    });

    it('turns a part payment into PARTIAL and reduces the due', async () => {
      const paid = 40_000;

      const response = await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/payments`)
        .set(authed(accountantToken))
        .send({ amountPaisa: paid, method: 'BKASH_MANUAL', reference: `TRX-A-${stamp}` })
        .expect(201);

      expect(response.body).toMatchObject({
        paidPaisa: paid,
        duePaisa: orderTotalPaisa - paid,
        status: 'PARTIAL',
      });

      // অর্ডারের paymentStatus-ও সার্ভার নিজে বদলেছে
      const order = await prisma.order.findUniqueOrThrow({
        where: { orderNumber },
        select: { paymentStatus: true },
      });
      expect(order.paymentStatus).toBe('PARTIAL');
    });

    /**
     * বিকাশ/নগদে TrxID ছাড়া এন্ট্রি নেওয়া যাবে না — পরে কোন টাকা
     * কার, সেটা মেলানোর আর কোনো উপায় থাকে না।
     */
    it('demands a reference for bkash and bank transfers', async () => {
      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/payments`)
        .set(authed(accountantToken))
        .send({ amountPaisa: 1_000, method: 'BKASH_MANUAL' })
        .expect(400);
    });

    /** COD-এ কুরিয়ার টাকা আনে, কোনো TrxID থাকে না। */
    it('does not demand a reference for cash on delivery', async () => {
      const response = await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/payments`)
        .set(authed(adminToken))
        .send({ amountPaisa: 1_000, method: 'COD' })
        .expect(201);

      expect(response.body.payments.some((p: { method: string }) => p.method === 'COD')).toBe(true);
    });

    it('rejects a zero or negative amount', async () => {
      for (const amountPaisa of [0, -500]) {
        await request(app.getHttpServer())
          .post(`/admin/orders/${orderNumber}/payments`)
          .set(authed(adminToken))
          .send({ amountPaisa, method: 'CASH' })
          .expect(400);
      }
    });

    /**
     * due-র বেশি নেওয়া আটকায় — নইলে রিফান্ডের হিসাব গুলিয়ে যায়
     * আর অ্যাকাউন্ট্যান্ট বুঝতে পারে না বাড়তি টাকা কোথা থেকে এলো।
     */
    it('refuses more than the amount still due', async () => {
      const current = await request(app.getHttpServer())
        .get(`/admin/orders/${orderNumber}/payments`)
        .set(authed(accountantToken))
        .expect(200);

      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/payments`)
        .set(authed(accountantToken))
        .send({ amountPaisa: current.body.duePaisa + 1, method: 'CASH' })
        .expect(409);
    });

    it('rejects the same reference twice — ভুল করে দুবার এন্ট্রি', async () => {
      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/payments`)
        .set(authed(accountantToken))
        .send({ amountPaisa: 1_000, method: 'BKASH_MANUAL', reference: `TRX-A-${stamp}` })
        .expect(409);
    });

    it('marks the order PAID when the last of the due comes in', async () => {
      const current = await request(app.getHttpServer())
        .get(`/admin/orders/${orderNumber}/payments`)
        .set(authed(accountantToken))
        .expect(200);

      const response = await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/payments`)
        .set(authed(accountantToken))
        .send({ amountPaisa: current.body.duePaisa, method: 'CASH' })
        .expect(201);

      expect(response.body).toMatchObject({ duePaisa: 0, status: 'PAID' });

      const order = await prisma.order.findUniqueOrThrow({
        where: { orderNumber },
        select: { paymentStatus: true },
      });
      expect(order.paymentStatus).toBe('PAID');
    });

    it('records who entered the payment', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/orders/${orderNumber}/payments`)
        .set(authed(adminToken))
        .expect(200);

      const entry = response.body.payments.find(
        (payment: { reference: string | null }) => payment.reference === `TRX-A-${stamp}`,
      );

      expect(entry.recordedBy).toMatchObject({ email: accountantEmail });
    });
  });

  describe('voiding', () => {
    it('needs a reason', async () => {
      const payments = await request(app.getHttpServer())
        .get(`/admin/orders/${orderNumber}/payments`)
        .set(authed(adminToken))
        .expect(200);

      await request(app.getHttpServer())
        .post(`/admin/payments/${payments.body.payments[0].id}/void`)
        .set(authed(adminToken))
        .send({})
        .expect(400);
    });

    /**
     * void মানে row মুছে ফেলা **নয়** — status বদলায় আর যোগফল থেকে
     * বাদ পড়ে, কিন্তু অডিট ট্রেইলে থেকে যায়।
     */
    it('brings the due back without deleting the row', async () => {
      const before = await request(app.getHttpServer())
        .get(`/admin/orders/${orderNumber}/payments`)
        .set(authed(adminToken))
        .expect(200);

      const target = before.body.payments.find(
        (payment: { status: string; amountPaisa: number }) => payment.status === 'RECEIVED',
      );

      const response = await request(app.getHttpServer())
        .post(`/admin/payments/${target.id}/void`)
        .set(authed(adminToken))
        .send({ reason: 'ভুল অর্ডারে এন্ট্রি হয়েছিল' })
        .expect(200);

      expect(response.body.duePaisa).toBe(target.amountPaisa);
      expect(response.body.status).toBe('PARTIAL');

      const voided = response.body.payments.find(
        (payment: { id: string }) => payment.id === target.id,
      );
      expect(voided).toMatchObject({ status: 'VOIDED', voidReason: 'ভুল অর্ডারে এন্ট্রি হয়েছিল' });
    });

    it('refuses to void the same payment twice', async () => {
      const payments = await request(app.getHttpServer())
        .get(`/admin/orders/${orderNumber}/payments`)
        .set(authed(adminToken))
        .expect(200);

      const alreadyVoided = payments.body.payments.find(
        (payment: { status: string }) => payment.status === 'VOIDED',
      );

      await request(app.getHttpServer())
        .post(`/admin/payments/${alreadyVoided.id}/void`)
        .set(authed(adminToken))
        .send({ reason: 'আবার বাতিল' })
        .expect(409);
    });

    it('refuses a designer', async () => {
      const payments = await request(app.getHttpServer())
        .get(`/admin/orders/${orderNumber}/payments`)
        .set(authed(adminToken))
        .expect(200);

      await request(app.getHttpServer())
        .post(`/admin/payments/${payments.body.payments[0].id}/void`)
        .set(authed(designerToken))
        .send({ reason: 'চেষ্টা' })
        .expect(403);
    });
  });

  describe('isolation', () => {
    it('hides one customer payments from another', async () => {
      await request(app.getHttpServer())
        .get(`/orders/${orderNumber}/payments`)
        .set(authed(otherToken))
        .expect(404);
    });

    it('answers 404 for an order number that does not exist', async () => {
      await request(app.getHttpServer())
        .get('/admin/orders/ORD-2020-0101-001/payments')
        .set(authed(adminToken))
        .expect(404);
    });
  });
});
