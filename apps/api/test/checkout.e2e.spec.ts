import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Cart → ঠিকানা → চেকআউট। আসল DB লাগে।
 *
 * এখানে যা প্রমাণ করা হচ্ছে, সেগুলোই দোকানের টাকা বাঁচায়:
 * দাম সার্ভারে হিসাব হয়, স্টকের বেশি বিক্রি হয় না, আর একজন
 * অন্যের অর্ডার দেখতে পায় না।
 */
describe('Cart and checkout', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const staffEmail = `co-staff-${stamp}@test.local`;
  const buyerEmail = `co-buyer-${stamp}@test.local`;
  const otherEmail = `co-other-${stamp}@test.local`;
  const password = 'secret123';

  let staffToken = '';
  let buyerToken = '';
  let otherToken = '';

  const categorySlug = `co-cat-${stamp}`;
  const productSlug = `co-shirt-${stamp}`;

  /** দাম **পয়সায়** — ৪৫০.০০ টাকা = 45000 */
  const UNIT_PRICE_PAISA = 45_000;
  const INITIAL_STOCK = 10;

  let variantId = '';
  let scarceVariantId = '';

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    // স্টাফ — প্রোডাক্ট বানাতে লাগবে
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: staffEmail, password, name: 'Staff' })
      .expect(201);

    await prisma.user.update({
      where: { email: staffEmail },
      data: { role: 'ORDER_MANAGER' },
    });

    const staffLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password })
      .expect(200);
    staffToken = staffLogin.body.accessToken;

    const buyer = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: buyerEmail, password, name: 'Buyer' })
      .expect(201);
    buyerToken = buyer.body.accessToken;

    const other = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: otherEmail, password, name: 'Other' })
      .expect(201);
    otherToken = other.body.accessToken;

    const category = await request(app.getHttpServer())
      .post('/admin/categories')
      .set(authed(staffToken))
      .send({ name: 'Checkout Cat', slug: categorySlug })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/admin/products')
      .set(authed(staffToken))
      .send({
        name: 'Checkout Shirt',
        slug: productSlug,
        categoryId: category.body.id,
        isPublished: true,
        variants: [
          {
            sku: `SKU-NORMAL-${stamp}`,
            pricePaisa: UNIT_PRICE_PAISA,
            stock: INITIAL_STOCK,
          },
          {
            sku: `SKU-SCARCE-${stamp}`,
            pricePaisa: UNIT_PRICE_PAISA,
            stock: 1,
          },
        ],
      })
      .expect(201);

    variantId = product.body.variants[0].id;
    scarceVariantId = product.body.variants[1].id;
  });

  afterAll(async () => {
    const emails = [staffEmail, buyerEmail, otherEmail];
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    // অর্ডার আগে — user মুছলে FK আটকাবে (Order.user-এ cascade নেই, ইচ্ছাকৃত)
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.product.deleteMany({ where: { slug: productSlug } });
    await prisma.category.deleteMany({ where: { slug: categorySlug } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  describe('cart', () => {
    it('starts empty', async () => {
      const response = await request(app.getHttpServer())
        .get('/cart')
        .set(authed(buyerToken))
        .expect(200);

      expect(response.body.items).toEqual([]);
      expect(response.body.subtotalPaisa).toBe(0);
    });

    /**
     * পরিচয় ছাড়াও কার্ট **পড়া** যায় — খালি দেখায় (Phase 18)।
     *
     * প্রথমবার সাইটে আসা ক্রেতার কাছে এখনো গেস্ট টোকেন নেই। তাকে
     * ৪০১ দিলে হোমপেজের কার্ট আইকনই ভাঙা দেখাত, অথচ সে কিছু ভুল
     * করেনি।
     */
    it('shows an empty cart to a caller with no identity', async () => {
      const response = await request(app.getHttpServer()).get('/cart').expect(200);

      expect(response.body.items).toEqual([]);
      expect(response.body.subtotalPaisa).toBe(0);
    });

    /**
     * কিন্তু **লেখা** যায় না — কার কার্টে লিখছি সেটা জানতেই হবে।
     *
     * না জেনে লিখলে কার্টটা কারো নয় এমন অবস্থায় পড়ে থাকত আর
     * ক্রেতা সেটা আর খুঁজে পেত না। গেস্ট আগে `POST /cart/guest`
     * দিয়ে টোকেন নেয়।
     */
    it('refuses to write to a cart with no identity', async () => {
      await request(app.getHttpServer())
        .post('/cart/items')
        .send({ variantId, quantity: 1 })
        .expect(401);
    });

    /**
     * চেকআউটেও একই — অর্ডার কার, সেটা জানতে হবে।
     *
     * ঠিকানাটা **বৈধ** পাঠানো হয় ইচ্ছাকৃতভাবে: খালি body পাঠালে
     * Zod আগেই ৪০০ দিত আর তখন পরিচয়ের অভাবটা আসলে পরীক্ষাই হতো না।
     */
    it('refuses a checkout with no identity', async () => {
      await request(app.getHttpServer())
        .post('/orders')
        .send({
          address: {
            fullName: 'No Identity',
            phone: '01800000000',
            line1: 'Road 1',
            city: 'Dhaka',
            district: 'Dhaka',
          },
        })
        .expect(401);
    });

    it('adds an item and prices it from the database', async () => {
      const response = await request(app.getHttpServer())
        .post('/cart/items')
        .set(authed(buyerToken))
        .send({ variantId, quantity: 2 })
        .expect(201);

      expect(response.body.items).toHaveLength(1);
      expect(response.body.items[0]).toMatchObject({
        variantId,
        quantity: 2,
        unitPricePaisa: UNIT_PRICE_PAISA,
        lineTotalPaisa: UNIT_PRICE_PAISA * 2,
      });
      expect(response.body.subtotalPaisa).toBe(UNIT_PRICE_PAISA * 2);
    });

    /**
     * ক্লায়েন্ট দাম পাঠালে সেটা **নীরবে উপেক্ষিত** হবে।
     * এটাই সবচেয়ে বড় আর্থিক গর্ত — ১ টাকায় ফোন কেনা আটকায় এই নিয়মে।
     */
    it('ignores any price the client sends', async () => {
      const response = await request(app.getHttpServer())
        .post('/cart/items')
        .set(authed(buyerToken))
        .send({ variantId, quantity: 1, pricePaisa: 1, unitPricePaisa: 1 })
        .expect(201);

      const item = response.body.items.find(
        (cartItem: { variantId: string }) => cartItem.variantId === variantId,
      );

      expect(item.unitPricePaisa).toBe(UNIT_PRICE_PAISA);
    });

    it('merges the same variant instead of duplicating the row', async () => {
      const response = await request(app.getHttpServer())
        .get('/cart')
        .set(authed(buyerToken))
        .expect(200);

      const rows = response.body.items.filter(
        (cartItem: { variantId: string }) => cartItem.variantId === variantId,
      );

      // আগের দুই কলে ২ + ১ যোগ হয়েছে
      expect(rows).toHaveLength(1);
      expect(rows[0].quantity).toBe(3);
    });

    it('refuses to add more than the stock on hand', async () => {
      await request(app.getHttpServer())
        .post('/cart/items')
        .set(authed(buyerToken))
        .send({ variantId, quantity: INITIAL_STOCK + 1 })
        .expect(409);
    });

    it('updates a quantity and removes an item', async () => {
      const cart = await request(app.getHttpServer())
        .get('/cart')
        .set(authed(buyerToken))
        .expect(200);

      const itemId = cart.body.items[0].id;

      const updated = await request(app.getHttpServer())
        .patch(`/cart/items/${itemId}`)
        .set(authed(buyerToken))
        .send({ quantity: 2 })
        .expect(200);

      expect(updated.body.items[0].quantity).toBe(2);
      expect(updated.body.subtotalPaisa).toBe(UNIT_PRICE_PAISA * 2);

      const emptied = await request(app.getHttpServer())
        .delete(`/cart/items/${itemId}`)
        .set(authed(buyerToken))
        .expect(200);

      expect(emptied.body.items).toEqual([]);
    });

    it('does not let one user touch another cart item', async () => {
      const added = await request(app.getHttpServer())
        .post('/cart/items')
        .set(authed(buyerToken))
        .send({ variantId, quantity: 1 })
        .expect(201);

      const itemId = added.body.items[0].id;

      await request(app.getHttpServer())
        .patch(`/cart/items/${itemId}`)
        .set(authed(otherToken))
        .send({ quantity: 5 })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/cart/items/${itemId}`)
        .set(authed(otherToken))
        .expect(404);
    });
  });

  describe('addresses', () => {
    it('makes the first address the default one', async () => {
      const response = await request(app.getHttpServer())
        .post('/addresses')
        .set(authed(buyerToken))
        .send({
          fullName: 'Buyer Name',
          phone: '01712345678',
          line1: 'House 10, Road 5',
          city: 'Dhanmondi',
          district: 'Dhaka',
          postcode: '1209',
        })
        .expect(201);

      expect(response.body.isDefault).toBe(true);
    });

    it('rejects a phone number that is not a Bangladeshi mobile', async () => {
      await request(app.getHttpServer())
        .post('/addresses')
        .set(authed(buyerToken))
        .send({
          fullName: 'Buyer Name',
          phone: '12345',
          line1: 'House 10, Road 5',
          city: 'Dhanmondi',
          district: 'Dhaka',
        })
        .expect(400);
    });

    it('lists only the caller own addresses', async () => {
      const response = await request(app.getHttpServer())
        .get('/addresses')
        .set(authed(otherToken))
        .expect(200);

      expect(response.body).toEqual([]);
    });
  });

  describe('checkout', () => {
    it('refuses to check out an empty cart', async () => {
      await request(app.getHttpServer())
        .post('/orders')
        .set(authed(otherToken))
        .send({
          address: {
            fullName: 'Other Name',
            phone: '01812345678',
            line1: 'Road 1, Block B',
            city: 'Uttara',
            district: 'Dhaka',
          },
        })
        .expect(400);
    });

    it('needs exactly one of addressId or a new address', async () => {
      await request(app.getHttpServer())
        .post('/orders')
        .set(authed(buyerToken))
        .send({})
        .expect(400);
    });

    /**
     * মূল কেস: দাম সার্ভারে হিসাব হয়, স্টক কমে, আর অর্ডারে
     * ঠিকানা ও দামের স্ন্যাপশট থেকে যায়।
     */
    it('creates an order, totals it server side and decrements stock', async () => {
      const before = await prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stock: true },
      });

      const cart = await request(app.getHttpServer())
        .get('/cart')
        .set(authed(buyerToken))
        .expect(200);
      const orderedQuantity = cart.body.items[0].quantity;

      const addresses = await request(app.getHttpServer())
        .get('/addresses')
        .set(authed(buyerToken))
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/orders')
        .set(authed(buyerToken))
        // দাম পাঠানোর চেষ্টা — উপেক্ষিত হওয়া উচিত
        .send({ addressId: addresses.body[0].id, totalPaisa: 1, note: 'দ্রুত পাঠান' })
        .expect(201);

      expect(response.body.orderNumber).toMatch(/^ORD-\d{4}-\d{4}-\d{3,}$/);
      expect(response.body.status).toBe('PENDING');
      expect(response.body.paymentStatus).toBe('UNPAID');
      expect(response.body.subtotalPaisa).toBe(UNIT_PRICE_PAISA * orderedQuantity);

      /**
       * মোট = subtotal + ডেলিভারি − ছাড় (Phase 14 থেকে শিপিং আসল)।
       *
       * নির্দিষ্ট অঙ্ক না লিখে সম্পর্কটা যাচাই করা হয়: অ্যাডমিন
       * চার্জ বদলালে টেস্ট ভাঙবে না, কিন্তু হিসাবের ভুল ধরা পড়বে।
       */
      expect(response.body.totalPaisa).toBe(
        response.body.subtotalPaisa +
          response.body.shippingPaisa -
          response.body.discountPaisa,
      );
      // ঢাকার ঠিকানা, তাই চার্জ বসেছে — আগে হার্ডকোড ০ ছিল
      expect(response.body.shippingPaisa).toBeGreaterThan(0);

      // ঠিকানার স্ন্যাপশট — পরে ঠিকানা বদলালেও অর্ডার অবিকৃত থাকবে
      expect(response.body.shipFullName).toBe('Buyer Name');
      expect(response.body.shipDistrict).toBe('Dhaka');

      // আইটেমে পণ্যের নাম ও দাম কপি হয়েছে
      expect(response.body.items[0]).toMatchObject({
        productName: 'Checkout Shirt',
        unitPricePaisa: UNIT_PRICE_PAISA,
        quantity: orderedQuantity,
        lineTotalPaisa: UNIT_PRICE_PAISA * orderedQuantity,
      });

      const after = await prisma.productVariant.findUniqueOrThrow({
        where: { id: variantId },
        select: { stock: true },
      });
      expect(after.stock).toBe(before.stock - orderedQuantity);
    });

    it('empties the cart once the order is placed', async () => {
      const response = await request(app.getHttpServer())
        .get('/cart')
        .set(authed(buyerToken))
        .expect(200);

      expect(response.body.items).toEqual([]);
    });

    it('records the opening status in history', async () => {
      const orders = await request(app.getHttpServer())
        .get('/orders')
        .set(authed(buyerToken))
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get(`/orders/${orders.body[0].orderNumber}`)
        .set(authed(buyerToken))
        .expect(200);

      expect(detail.body.history).toHaveLength(1);
      expect(detail.body.history[0]).toMatchObject({
        fromStatus: null,
        toStatus: 'PENDING',
      });
    });
  });

  describe('order isolation', () => {
    it('hides one customer order from another', async () => {
      const orders = await request(app.getHttpServer())
        .get('/orders')
        .set(authed(buyerToken))
        .expect(200);

      const orderNumber = orders.body[0].orderNumber;

      await request(app.getHttpServer())
        .get(`/orders/${orderNumber}`)
        .set(authed(otherToken))
        .expect(404);

      const otherList = await request(app.getHttpServer())
        .get('/orders')
        .set(authed(otherToken))
        .expect(200);

      expect(otherList.body).toEqual([]);
    });
  });

  describe('stock safety', () => {
    /**
     * দুটো চেকআউট একসাথে, স্টকে মাত্র ১টা — একটাই জিততে হবে।
     * দুটোই সফল হলে oversell, মানে গ্রাহককে ফোন করে "পণ্য নেই" বলতে হবে।
     */
    it('lets only one of two concurrent checkouts take the last unit', async () => {
      const buyers = [buyerToken, otherToken];

      for (const token of buyers) {
        await request(app.getHttpServer())
          .post('/cart/items')
          .set(authed(token))
          .send({ variantId: scarceVariantId, quantity: 1 })
          .expect(201);
      }

      const address = {
        fullName: 'Race Buyer',
        phone: '01912345678',
        line1: 'Road 7, House 3',
        city: 'Banani',
        district: 'Dhaka',
      };

      const results = await Promise.allSettled(
        buyers.map((token) =>
          request(app.getHttpServer()).post('/orders').set(authed(token)).send({ address }),
        ),
      );

      const statuses = results.map((result) =>
        result.status === 'fulfilled' ? result.value.status : 500,
      );

      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(1);

      const variant = await prisma.productVariant.findUniqueOrThrow({
        where: { id: scarceVariantId },
        select: { stock: true },
      });

      // কখনোই ঋণাত্মক নয়
      expect(variant.stock).toBe(0);
    });

    /** একসাথে অর্ডার হলেও দুটো আলাদা নম্বর পাবে। */
    it('never hands two orders the same number', async () => {
      const orders = await prisma.order.findMany({
        where: { user: { email: { in: [buyerEmail, otherEmail] } } },
        select: { orderNumber: true },
      });

      const unique = new Set(orders.map((order) => order.orderNumber));

      expect(unique.size).toBe(orders.length);
    });
  });
});
