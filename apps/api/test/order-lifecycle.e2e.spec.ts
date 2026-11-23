import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * অর্ডারের জীবনচক্র, বাতিল, অ্যাডমিন তালিকা আর public tracking।
 * আসল DB লাগে।
 */
describe('Order lifecycle', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const adminEmail = `lc-admin-${stamp}@test.local`;
  const designerEmail = `lc-design-${stamp}@test.local`;
  const buyerEmail = `lc-buyer-${stamp}@test.local`;
  const otherEmail = `lc-other-${stamp}@test.local`;
  const password = 'secret123';

  let adminToken = '';
  let designerToken = '';
  let buyerToken = '';
  let otherToken = '';

  const categorySlug = `lc-cat-${stamp}`;
  const productSlug = `lc-item-${stamp}`;
  const buyerPhone = '01712345678';

  const UNIT_PRICE_PAISA = 50_000;
  const STOCK = 20;

  let variantId = '';

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  const makeUser = async (email: string, role?: string): Promise<string> => {
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Lifecycle Test' })
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
  const placeOrder = async (token: string, quantity = 1): Promise<string> => {
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(authed(token))
      .send({ variantId, quantity })
      .expect(201);

    const order = await request(app.getHttpServer())
      .post('/orders')
      .set(authed(token))
      .send({
        address: {
          fullName: 'Lifecycle Buyer',
          phone: buyerPhone,
          line1: 'House 2, Road 3',
          city: 'Gulshan',
          district: 'Dhaka',
        },
      })
      .expect(201);

    return order.body.orderNumber;
  };

  /** status বদলায়, ধাপে ধাপে। */
  const moveTo = async (orderNumber: string, toStatus: string): Promise<void> => {
    await request(app.getHttpServer())
      .patch(`/admin/orders/${orderNumber}/status`)
      .set(authed(adminToken))
      .send({ toStatus })
      .expect(200);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    adminToken = await makeUser(adminEmail, 'SUPER_ADMIN');
    designerToken = await makeUser(designerEmail, 'DESIGNER');
    buyerToken = await makeUser(buyerEmail);
    otherToken = await makeUser(otherEmail);

    const category = await request(app.getHttpServer())
      .post('/admin/categories')
      .set(authed(adminToken))
      .send({ name: 'Lifecycle Cat', slug: categorySlug })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/admin/products')
      .set(authed(adminToken))
      .send({
        name: 'Lifecycle Item',
        slug: productSlug,
        categoryId: category.body.id,
        isPublished: true,
        variants: [{ sku: `SKU-LC-${stamp}`, pricePaisa: UNIT_PRICE_PAISA, stock: STOCK }],
      })
      .expect(201);

    variantId = product.body.variants[0].id;
  });

  afterAll(async () => {
    const emails = [adminEmail, designerEmail, buyerEmail, otherEmail];
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.product.deleteMany({ where: { slug: productSlug } });
    await prisma.category.deleteMany({ where: { slug: categorySlug } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  describe('changing status', () => {
    it('walks an order forward one step at a time', async () => {
      const orderNumber = await placeOrder(buyerToken);

      for (const status of ['DESIGN_CONFIRMED', 'IN_PRODUCTION', 'PRINTED', 'SHIPPED']) {
        const response = await request(app.getHttpServer())
          .patch(`/admin/orders/${orderNumber}/status`)
          .set(authed(adminToken))
          .send({ toStatus: status })
          .expect(200);

        expect(response.body.status).toBe(status);
      }

      const delivered = await request(app.getHttpServer())
        .patch(`/admin/orders/${orderNumber}/status`)
        .set(authed(adminToken))
        .send({ toStatus: 'DELIVERED' })
        .expect(200);

      expect(delivered.body.status).toBe('DELIVERED');
    });

    /** প্রতিটা বদল ইতিহাসে লেখা থাকে — কে, কখন, কী থেকে কী। */
    it('writes every change to the history with who did it', async () => {
      const orderNumber = await placeOrder(buyerToken);
      await moveTo(orderNumber, 'DESIGN_CONFIRMED');

      const detail = await request(app.getHttpServer())
        .get(`/admin/orders/${orderNumber}`)
        .set(authed(adminToken))
        .expect(200);

      // প্রথমটা অর্ডার খোলার, দ্বিতীয়টা আমাদের বদল
      expect(detail.body.history).toHaveLength(2);
      expect(detail.body.history[1]).toMatchObject({
        fromStatus: 'PENDING',
        toStatus: 'DESIGN_CONFIRMED',
      });
      expect(detail.body.history[1].changedBy).toMatchObject({ email: adminEmail });
    });

    it('refuses a step that skips ahead', async () => {
      const orderNumber = await placeOrder(buyerToken);

      await request(app.getHttpServer())
        .patch(`/admin/orders/${orderNumber}/status`)
        .set(authed(adminToken))
        .send({ toStatus: 'SHIPPED' })
        .expect(409);
    });

    /** ডেলিভারি হওয়া অর্ডার আবার আগের অবস্থায় ফেরানো যাবে না। */
    it('refuses to move a delivered order backwards', async () => {
      const orderNumber = await placeOrder(buyerToken);

      for (const status of ['DESIGN_CONFIRMED', 'IN_PRODUCTION', 'PRINTED', 'SHIPPED', 'DELIVERED']) {
        await moveTo(orderNumber, status);
      }

      await request(app.getHttpServer())
        .patch(`/admin/orders/${orderNumber}/status`)
        .set(authed(adminToken))
        .send({ toStatus: 'SHIPPED' })
        .expect(409);
    });

    it('rejects a status that is not in the enum', async () => {
      const orderNumber = await placeOrder(buyerToken);

      await request(app.getHttpServer())
        .patch(`/admin/orders/${orderNumber}/status`)
        .set(authed(adminToken))
        .send({ toStatus: 'TELEPORTED' })
        .expect(400);
    });
  });

  describe('who may change what', () => {
    it('refuses a customer outright', async () => {
      const orderNumber = await placeOrder(buyerToken);

      await request(app.getHttpServer())
        .patch(`/admin/orders/${orderNumber}/status`)
        .set(authed(buyerToken))
        .send({ toStatus: 'DESIGN_CONFIRMED' })
        .expect(403);
    });

    /**
     * ডিজাইনার নিজের ধাপটাই এগোতে পারে — ডিজাইন অনুমোদিত হলে
     * প্রোডাকশনে পাঠানো। ডেলিভারি তার কাজ নয়।
     */
    it('lets a designer move design to production', async () => {
      const orderNumber = await placeOrder(buyerToken);
      await moveTo(orderNumber, 'DESIGN_CONFIRMED');

      const response = await request(app.getHttpServer())
        .patch(`/admin/orders/${orderNumber}/status`)
        .set(authed(designerToken))
        .send({ toStatus: 'IN_PRODUCTION' })
        .expect(200);

      expect(response.body.status).toBe('IN_PRODUCTION');
    });

    it('stops a designer from marking an order delivered', async () => {
      const orderNumber = await placeOrder(buyerToken);

      for (const status of ['DESIGN_CONFIRMED', 'IN_PRODUCTION', 'PRINTED', 'SHIPPED']) {
        await moveTo(orderNumber, status);
      }

      await request(app.getHttpServer())
        .patch(`/admin/orders/${orderNumber}/status`)
        .set(authed(designerToken))
        .send({ toStatus: 'DELIVERED' })
        .expect(403);
    });
  });

  describe('cancelling', () => {
    /** বাতিল হলে স্টক ফেরত আসতে হবে — নইলে বিক্রি না হওয়া পণ্য হারিয়ে যায়। */
    it('returns the stock it had taken', async () => {
      const before = await prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stock: true },
      });

      const orderNumber = await placeOrder(buyerToken, 3);

      const during = await prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stock: true },
      });
      expect(during.stock).toBe(before.stock - 3);

      await request(app.getHttpServer())
        .post(`/orders/${orderNumber}/cancel`)
        .set(authed(buyerToken))
        .send({ reason: 'ভুল সাইজ দিয়েছি' })
        .expect(200);

      const after = await prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stock: true },
      });
      expect(after.stock).toBe(before.stock);
    });

    it('lets a customer cancel only while the order is pending', async () => {
      const orderNumber = await placeOrder(buyerToken);
      await moveTo(orderNumber, 'DESIGN_CONFIRMED');

      await request(app.getHttpServer())
        .post(`/orders/${orderNumber}/cancel`)
        .set(authed(buyerToken))
        .send({ reason: 'মন বদলেছে' })
        .expect(409);
    });

    it('does not let one customer cancel another order', async () => {
      const orderNumber = await placeOrder(buyerToken);

      await request(app.getHttpServer())
        .post(`/orders/${orderNumber}/cancel`)
        .set(authed(otherToken))
        .send({ reason: 'ইচ্ছে হলো' })
        .expect(404);
    });

    it('needs a reason', async () => {
      const orderNumber = await placeOrder(buyerToken);

      await request(app.getHttpServer())
        .post(`/orders/${orderNumber}/cancel`)
        .set(authed(buyerToken))
        .send({})
        .expect(400);
    });

    /**
     * ছাপা হয়ে গেলে স্টাফও বাতিল করতে পারবে না — কাপড় ও কাজ
     * দুটোই খরচ হয়ে গেছে।
     */
    it('refuses to cancel once the design is printed', async () => {
      const orderNumber = await placeOrder(buyerToken);

      for (const status of ['DESIGN_CONFIRMED', 'IN_PRODUCTION', 'PRINTED']) {
        await moveTo(orderNumber, status);
      }

      await request(app.getHttpServer())
        .patch(`/admin/orders/${orderNumber}/status`)
        .set(authed(adminToken))
        .send({ toStatus: 'CANCELLED' })
        .expect(409);
    });

    it('does not return the stock twice', async () => {
      const orderNumber = await placeOrder(buyerToken, 2);

      await request(app.getHttpServer())
        .post(`/orders/${orderNumber}/cancel`)
        .set(authed(buyerToken))
        .send({ reason: 'প্রথমবার' })
        .expect(200);

      const after = await prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stock: true },
      });

      await request(app.getHttpServer())
        .post(`/orders/${orderNumber}/cancel`)
        .set(authed(buyerToken))
        .send({ reason: 'দ্বিতীয়বার' })
        .expect(409);

      const unchanged = await prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stock: true },
      });
      expect(unchanged.stock).toBe(after.stock);
    });
  });

  describe('admin order board', () => {
    it('lists orders newest first with a page of results', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/orders?perPage=5')
        .set(authed(adminToken))
        .expect(200);

      expect(response.body.orders.length).toBeLessThanOrEqual(5);
      expect(response.body).toMatchObject({ page: 1, perPage: 5 });
      expect(typeof response.body.total).toBe('number');
    });

    it('finds an order by its number', async () => {
      const orderNumber = await placeOrder(buyerToken);

      const response = await request(app.getHttpServer())
        .get(`/admin/orders?search=${orderNumber}`)
        .set(authed(adminToken))
        .expect(200);

      expect(response.body.orders).toHaveLength(1);
      expect(response.body.orders[0].orderNumber).toBe(orderNumber);
    });

    it('finds orders by the shipping phone', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/orders?search=${buyerPhone}`)
        .set(authed(adminToken))
        .expect(200);

      expect(response.body.orders.length).toBeGreaterThan(0);
    });

    it('filters by status', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/orders?status=CANCELLED')
        .set(authed(adminToken))
        .expect(200);

      for (const order of response.body.orders) {
        expect(order.status).toBe('CANCELLED');
      }
    });

    /** `perPage=100000` দিয়ে পুরো DB টেনে নেওয়া আটকায়। */
    it('caps how many rows one page may ask for', async () => {
      await request(app.getHttpServer())
        .get('/admin/orders?perPage=100000')
        .set(authed(adminToken))
        .expect(400);
    });

    it('refuses a customer', async () => {
      await request(app.getHttpServer()).get('/admin/orders').set(authed(buyerToken)).expect(403);
    });
  });

  describe('public tracking', () => {
    let trackable = '';

    beforeAll(async () => {
      trackable = await placeOrder(buyerToken);
      await moveTo(trackable, 'DESIGN_CONFIRMED');
    });

    /** লগইন ছাড়াই — ফোন মিললে অবস্থা দেখা যাবে। */
    it('shows the status to anyone with the number and the phone', async () => {
      const response = await request(app.getHttpServer())
        .post('/track')
        .send({ orderNumber: trackable, phone: buyerPhone })
        .expect(200);

      expect(response.body).toMatchObject({
        orderNumber: trackable,
        status: 'DESIGN_CONFIRMED',
      });
      expect(response.body.items.length).toBeGreaterThan(0);
      expect(response.body.history.length).toBeGreaterThan(0);
    });

    /**
     * ফোন না মিললে ৪০৪ — Order ID-তে তারিখ আর সিরিয়াল থাকায়
     * কেউ ০০১ থেকে গুনে সব অর্ডার দেখে ফেলতে পারত।
     */
    it('refuses a wrong phone number', async () => {
      await request(app.getHttpServer())
        .post('/track')
        .send({ orderNumber: trackable, phone: '01911111111' })
        .expect(404);
    });

    it('refuses an order number that does not exist', async () => {
      await request(app.getHttpServer())
        .post('/track')
        .send({ orderNumber: 'ORD-2020-0101-001', phone: buyerPhone })
        .expect(404);
    });

    it('rejects a malformed order number', async () => {
      await request(app.getHttpServer())
        .post('/track')
        .send({ orderNumber: 'nonsense', phone: buyerPhone })
        .expect(400);
    });

    /**
     * টাকার হিসাব **ফাঁস হবে না** — লগইন ছাড়া কে কত দিয়েছে বা
     * কত বাকি, সেটা দেখানো ঠিক নয়।
     */
    it('does not leak the money side or the customer identity', async () => {
      const response = await request(app.getHttpServer())
        .post('/track')
        .send({ orderNumber: trackable, phone: buyerPhone })
        .expect(200);

      expect(response.body.paidPaisa).toBeUndefined();
      expect(response.body.duePaisa).toBeUndefined();
      expect(response.body.payments).toBeUndefined();
      expect(response.body.userId).toBeUndefined();
      // ঠিকানার পুরোটা নয় — শহর/জেলা যথেষ্ট
      expect(response.body.shipLine1).toBeUndefined();
      expect(response.body.shipPhone).toBeUndefined();
    });
  });
});
