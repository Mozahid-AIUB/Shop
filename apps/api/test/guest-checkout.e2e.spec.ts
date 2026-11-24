import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * গেস্ট চেকআউট — অ্যাকাউন্ট ছাড়া কেনা।
 *
 * **কেন দরকার:** বাংলাদেশে অনেক ক্রেতা অ্যাকাউন্ট খুলতে চায় না।
 * রেজিস্ট্রেশন বাধ্যতামূলক রাখলে কেনার ইচ্ছা নিয়ে আসা ক্রেতাও
 * ফিরে যায় — আর সেটা কোথাও ত্রুটি হিসেবে দেখায় না।
 *
 * **এখানে ভুলের দাম গোপনীয়তায়।** `userId` nullable করার মানে
 * ownership যাচাইয়ের প্রতিটা জায়গা নতুন করে দেখতে হবে — নইলে এক
 * গেস্টের কার্ট বা অর্ডার অন্য কেউ দেখে ফেলবে। তাই এই suite-এ
 * আলাদা করে **বিচ্ছিন্নতা** (isolation) প্রমাণ করা হয়।
 */
describe('Guest checkout', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const adminEmail = `gc-admin-${stamp}@test.local`;
  const memberEmail = `gc-member-${stamp}@test.local`;
  const password = 'secret123';

  let adminToken = '';
  let memberToken = '';

  const categorySlug = `gc-cat-${stamp}`;
  const productSlug = `gc-shirt-${stamp}`;

  const UNIT_PRICE_PAISA = 40_000;

  let variantId = '';

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  /** গেস্টকে চেনানোর header। */
  const asGuest = (token: string) => ({ 'x-guest-token': token });

  let phoneSlot = 0;
  const nextPhone = (): string => {
    phoneSlot += 1;
    return `018${String(stamp % 1_000_000).padStart(6, '0')}${String(phoneSlot).padStart(2, '0')}`;
  };

  const guestAddress = (phone?: string) => ({
    fullName: 'Guest Buyer',
    phone: phone ?? nextPhone(),
    line1: 'House 12, Road 5',
    city: 'Dhaka',
    district: 'Dhaka',
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: adminEmail, password, name: 'Guest Admin' })
      .expect(201);

    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'SUPER_ADMIN' } });

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = adminLogin.body.accessToken;

    const member = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: memberEmail, password, name: 'Member Buyer' })
      .expect(201);
    memberToken = member.body.accessToken;

    const category = await request(app.getHttpServer())
      .post('/admin/categories')
      .set(authed(adminToken))
      .send({ name: 'Guest Cat', slug: categorySlug })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/admin/products')
      .set(authed(adminToken))
      .send({
        name: 'Guest Shirt',
        slug: productSlug,
        categoryId: category.body.id,
        isPublished: true,
        variants: [{ sku: `SKU-GC-${stamp}`, pricePaisa: UNIT_PRICE_PAISA, stock: 500 }],
      })
      .expect(201);

    variantId = product.body.variants[0].id;
  });

  afterAll(async () => {
    const emails = [adminEmail, memberEmail];
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    // গেস্ট অর্ডারগুলোও — ঠিকানার ফোন দিয়ে চেনা যায় না, তাই পণ্য ধরে
    await prisma.order.deleteMany({
      where: {
        OR: [{ userId: { in: userIds } }, { items: { some: { variantSku: `SKU-GC-${stamp}` } } }],
      },
    });
    await prisma.cart.deleteMany({ where: { guestToken: { startsWith: `gtok-${stamp}` } } });
    await prisma.product.deleteMany({ where: { slug: productSlug } });
    await prisma.category.deleteMany({ where: { slug: categorySlug } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  describe('the guest token', () => {
    /**
     * টোকেন সার্ভার দেয়, ক্লায়েন্ট বানায় না।
     *
     * ক্লায়েন্টকে বানাতে দিলে কেউ `guest-1`, `guest-2` পাঠিয়ে অন্যের
     * কার্ট খুলে ফেলত। সার্ভারের দেওয়া টোকেন অনুমান করা যায় না।
     */
    it('hands out a token nobody can guess', async () => {
      const first = await request(app.getHttpServer()).post('/cart/guest').expect(201);
      const second = await request(app.getHttpServer()).post('/cart/guest').expect(201);

      expect(typeof first.body.guestToken).toBe('string');
      // অনুমান করা শক্ত হতে হবে — ছোট বা ক্রমিক টোকেন চলবে না
      expect(first.body.guestToken.length).toBeGreaterThanOrEqual(24);
      expect(first.body.guestToken).not.toBe(second.body.guestToken);
    });
  });

  describe('a guest can shop', () => {
    it('keeps a cart without any account', async () => {
      const session = await request(app.getHttpServer()).post('/cart/guest').expect(201);
      const guestToken = session.body.guestToken;

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(asGuest(guestToken))
        .send({ variantId, quantity: 2 })
        .expect(201);

      const cart = await request(app.getHttpServer())
        .get('/cart')
        .set(asGuest(guestToken))
        .expect(200);

      expect(cart.body.items).toHaveLength(1);
      expect(cart.body.items[0].quantity).toBe(2);
    });

    it('places an order without an account', async () => {
      const session = await request(app.getHttpServer()).post('/cart/guest').expect(201);
      const guestToken = session.body.guestToken;

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(asGuest(guestToken))
        .send({ variantId, quantity: 1 })
        .expect(201);

      const order = await request(app.getHttpServer())
        .post('/orders')
        .set(asGuest(guestToken))
        .send({ address: guestAddress() })
        .expect(201);

      expect(order.body.orderNumber).toBeTruthy();
      expect(order.body.subtotalPaisa).toBe(UNIT_PRICE_PAISA);

      // অর্ডারটা সত্যিই গেস্টের — কোনো অ্যাকাউন্টে বাঁধা নয়
      const saved = await prisma.order.findUniqueOrThrow({
        where: { orderNumber: order.body.orderNumber },
      });

      expect(saved.userId).toBeNull();
    });

    /** অর্ডার হয়ে গেলে কার্ট খালি — নইলে একই অর্ডার আবার চলে যেত। */
    it('empties the cart after the order', async () => {
      const session = await request(app.getHttpServer()).post('/cart/guest').expect(201);
      const guestToken = session.body.guestToken;

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(asGuest(guestToken))
        .send({ variantId, quantity: 1 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/orders')
        .set(asGuest(guestToken))
        .send({ address: guestAddress() })
        .expect(201);

      const cart = await request(app.getHttpServer())
        .get('/cart')
        .set(asGuest(guestToken))
        .expect(200);

      expect(cart.body.items).toHaveLength(0);
    });

    /** গেস্টের সংরক্ষিত ঠিকানা নেই, তাই ঠিকানা লেখা বাধ্যতামূলক। */
    it('refuses an order with no address', async () => {
      const session = await request(app.getHttpServer()).post('/cart/guest').expect(201);
      const guestToken = session.body.guestToken;

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(asGuest(guestToken))
        .send({ variantId, quantity: 1 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/orders')
        .set(asGuest(guestToken))
        .send({})
        .expect(400);
    });

    it('refuses an order with an empty cart', async () => {
      const session = await request(app.getHttpServer()).post('/cart/guest').expect(201);

      await request(app.getHttpServer())
        .post('/orders')
        .set(asGuest(session.body.guestToken))
        .send({ address: guestAddress() })
        .expect(400);
    });
  });

  describe('one guest cannot reach another', () => {
    /**
     * **সবচেয়ে গুরুত্বপূর্ণ টেস্ট।** দুই গেস্টের কার্ট আলাদা থাকতে
     * হবে। না থাকলে একজনের কার্টে অন্যজনের পণ্য দেখাত, আর চেকআউটে
     * ভুল জিনিস চলে যেত।
     */
    it('keeps two guest carts apart', async () => {
      const one = await request(app.getHttpServer()).post('/cart/guest').expect(201);
      const two = await request(app.getHttpServer()).post('/cart/guest').expect(201);

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(asGuest(one.body.guestToken))
        .send({ variantId, quantity: 3 })
        .expect(201);

      const otherCart = await request(app.getHttpServer())
        .get('/cart')
        .set(asGuest(two.body.guestToken))
        .expect(200);

      expect(otherCart.body.items).toHaveLength(0);
    });

    /** অনুমান করা টোকেনে কারো কার্ট খোলা যাবে না। */
    it('gives nothing for a made-up token', async () => {
      const response = await request(app.getHttpServer())
        .get('/cart')
        .set(asGuest(`gtok-${stamp}-made-up-token-value`))
        .expect(200);

      expect(response.body.items).toHaveLength(0);
    });

    /**
     * এক গেস্ট অন্য গেস্টের কার্টের আইটেম মুছতে বা বদলাতে পারবে না।
     * আইটেমের id জানলেও নয় — তাই ownership আইটেম ধরে যাচাই হতে হবে।
     */
    it('refuses to touch an item from another guest cart', async () => {
      const owner = await request(app.getHttpServer()).post('/cart/guest').expect(201);
      const stranger = await request(app.getHttpServer()).post('/cart/guest').expect(201);

      const added = await request(app.getHttpServer())
        .post('/cart/items')
        .set(asGuest(owner.body.guestToken))
        .send({ variantId, quantity: 1 })
        .expect(201);

      const itemId = added.body.items[0].id;

      await request(app.getHttpServer())
        .patch(`/cart/items/${itemId}`)
        .set(asGuest(stranger.body.guestToken))
        .send({ quantity: 99 })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/cart/items/${itemId}`)
        .set(asGuest(stranger.body.guestToken))
        .expect(404);
    });
  });

  describe('guests and members stay separate', () => {
    /** গেস্টের টোকেন দিয়ে লগইন করা ইউজারের কার্ট পাওয়া যাবে না। */
    it('does not expose a member cart to a guest token', async () => {
      await request(app.getHttpServer())
        .post('/cart/items')
        .set(authed(memberToken))
        .send({ variantId, quantity: 4 })
        .expect(201);

      const session = await request(app.getHttpServer()).post('/cart/guest').expect(201);

      const guestCart = await request(app.getHttpServer())
        .get('/cart')
        .set(asGuest(session.body.guestToken))
        .expect(200);

      expect(guestCart.body.items).toHaveLength(0);
    });

    /**
     * লগইন করা থাকলে তার নিজের কার্টই চলবে — সাথে গেস্ট header
     * পাঠানো হলেও। নইলে কেউ অন্যের গেস্ট টোকেন বসিয়ে নিজের
     * পরিচয়ে অন্যের কার্ট দেখত।
     */
    it('ignores a guest token when the caller is logged in', async () => {
      const session = await request(app.getHttpServer()).post('/cart/guest').expect(201);
      const guestToken = session.body.guestToken;

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(asGuest(guestToken))
        .send({ variantId, quantity: 7 })
        .expect(201);

      const memberCart = await request(app.getHttpServer())
        .get('/cart')
        .set(authed(memberToken))
        .set(asGuest(guestToken))
        .expect(200);

      // সদস্যের নিজের কার্ট — গেস্টের ৭টা নয়
      const quantities = memberCart.body.items.map((item: { quantity: number }) => item.quantity);

      expect(quantities).not.toContain(7);
    });

    /**
     * **গেস্ট কখনো লগইন করা ইউজারের অর্ডার দেখবে না।** `userId`
     * nullable হওয়ার পর `where: { userId }` আর যথেষ্ট নয় — `null`
     * মিলিয়ে দিলে গেস্ট সব গেস্ট-অর্ডার দেখে ফেলত।
     */
    it('never shows a member order to a guest', async () => {
      await request(app.getHttpServer())
        .post('/cart/items')
        .set(authed(memberToken))
        .send({ variantId, quantity: 1 })
        .expect(201);

      const memberOrder = await request(app.getHttpServer())
        .post('/orders')
        .set(authed(memberToken))
        .send({ address: guestAddress() })
        .expect(201);

      const session = await request(app.getHttpServer()).post('/cart/guest').expect(201);

      await request(app.getHttpServer())
        .get(`/orders/${memberOrder.body.orderNumber}`)
        .set(asGuest(session.body.guestToken))
        .expect(401);
    });

    /** গেস্ট অর্ডারের তালিকা চাইতে পারবে না — তার পরিচয় নেই। */
    it('refuses to list orders for a guest', async () => {
      const session = await request(app.getHttpServer()).post('/cart/guest').expect(201);

      await request(app.getHttpServer())
        .get('/orders')
        .set(asGuest(session.body.guestToken))
        .expect(401);
    });

    /**
     * গেস্ট নিজের অর্ডারও `/orders/:number` দিয়ে দেখবে না — ওটা
     * লগইন করা ইউজারের পথ। গেস্টের জন্য `/track` (ফোন + নম্বর),
     * যেটা Phase 06-এ আগেই আছে।
     */
    it('sends a guest to the tracking route instead', async () => {
      const session = await request(app.getHttpServer()).post('/cart/guest').expect(201);
      const guestToken = session.body.guestToken;
      const phone = nextPhone();

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(asGuest(guestToken))
        .send({ variantId, quantity: 1 })
        .expect(201);

      const order = await request(app.getHttpServer())
        .post('/orders')
        .set(asGuest(guestToken))
        .send({ address: guestAddress(phone) })
        .expect(201);

      const tracked = await request(app.getHttpServer())
        .post('/orders/track')
        .send({ orderNumber: order.body.orderNumber, phone })
        .expect(200);

      expect(tracked.body.orderNumber).toBe(order.body.orderNumber);
    });
  });

  describe('a guest can still use a coupon', () => {
    /**
     * কুপনের প্রতি-ইউজার সীমা `userId` ধরে গোনা হয়। গেস্টের
     * `userId` নেই, তাই সীমাওয়ালা কুপন গেস্টে চলবে না — চুপচাপ
     * সবাইকে অসীম ছাড় দেওয়ার চেয়ে স্পষ্ট প্রত্যাখ্যান ভালো।
     */
    it('refuses a per-customer limited coupon for a guest', async () => {
      const code = `GUESTLIM${stamp}`;

      await request(app.getHttpServer())
        .post('/admin/coupons')
        .set(authed(adminToken))
        .send({ code, type: 'FIXED', value: 5_000, maxUsesPerUser: 1 })
        .expect(201);

      const session = await request(app.getHttpServer()).post('/cart/guest').expect(201);

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(asGuest(session.body.guestToken))
        .send({ variantId, quantity: 1 })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post('/orders')
        .set(asGuest(session.body.guestToken))
        .send({ address: guestAddress(), couponCode: code });

      expect(response.status).toBe(400);

      await prisma.coupon.deleteMany({ where: { code } });
    });
  });

  describe('guest orders are not claimed by an account', () => {
    /**
     * **সিদ্ধান্ত: ফোন মিলিয়ে অর্ডার জোড়া হয় না।**
     *
     * জোড়া দিতে গেলে ফোনটা যাচাই করা থাকতে হয়, নইলে কেউ পরিচিতের
     * নম্বর বসিয়ে অ্যাকাউন্ট খুললে তার কী কিনেছে, কোথায় থাকে — সব
     * দেখে ফেলত। রেজিস্ট্রেশনে ফোন যাচাই হয় না (OTP Phase 08-এ),
     * তাই এখন জোড়া দেওয়া মানে একটা নীরব তথ্য ফাঁস।
     *
     * গেস্ট তার অর্ডার `/orders/track`-এ ফোন + নম্বর দিয়ে দেখতে
     * পারে — সেটা দুটোই জানা লাগে, তাই অনুমান করে খোলা যায় না।
     */
    it('keeps a guest order out of a new account with the same phone', async () => {
      const session = await request(app.getHttpServer()).post('/cart/guest').expect(201);
      const guestToken = session.body.guestToken;
      const phone = nextPhone();

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(asGuest(guestToken))
        .send({ variantId, quantity: 1 })
        .expect(201);

      const guestOrder = await request(app.getHttpServer())
        .post('/orders')
        .set(asGuest(guestToken))
        .send({ address: guestAddress(phone) })
        .expect(201);

      const newEmail = `gc-claimed-${stamp}@test.local`;

      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: newEmail, password, name: 'Claimed Buyer', phone })
        .expect(201);

      const orders = await request(app.getHttpServer())
        .get('/orders')
        .set(authed(registered.body.accessToken))
        .expect(200);

      const numbers = orders.body.map((order: { orderNumber: string }) => order.orderNumber);

      // একই ফোন হলেও জোড়া হয়নি — ফোন যাচাই করা নেই
      expect(numbers).not.toContain(guestOrder.body.orderNumber);

      // কিন্তু ট্র্যাক করে ঠিকই দেখা যায়
      const tracked = await request(app.getHttpServer())
        .post('/orders/track')
        .send({ orderNumber: guestOrder.body.orderNumber, phone })
        .expect(200);

      expect(tracked.body.orderNumber).toBe(guestOrder.body.orderNumber);

      await prisma.order.deleteMany({ where: { orderNumber: guestOrder.body.orderNumber } });
      await prisma.user.deleteMany({ where: { email: newEmail } });
    });

    /** ভুল ফোনে ট্র্যাকও হবে না — দুটোই মিলতে হয়। */
    it('refuses to track a guest order with the wrong phone', async () => {
      const session = await request(app.getHttpServer()).post('/cart/guest').expect(201);
      const guestToken = session.body.guestToken;

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(asGuest(guestToken))
        .send({ variantId, quantity: 1 })
        .expect(201);

      const order = await request(app.getHttpServer())
        .post('/orders')
        .set(asGuest(guestToken))
        .send({ address: guestAddress() })
        .expect(201);

      await request(app.getHttpServer())
        .post('/orders/track')
        .send({ orderNumber: order.body.orderNumber, phone: nextPhone() })
        .expect(404);
    });
  });
});
