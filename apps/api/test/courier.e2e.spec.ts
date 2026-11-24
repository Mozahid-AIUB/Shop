import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * কুরিয়ার — পার্সেল পাঠানো ও ট্র্যাক করা।
 *
 * **এখানে ভুলের দাম দুই জায়গায়:**
 *
 * ১. **key ফাঁস।** কুরিয়ারের key ব্যবসার নিজের অ্যাকাউন্টে বাঁধা।
 *    হাতে পেলে যে কেউ ওই অ্যাকাউন্ট দিয়ে পার্সেল পাঠাতে পারে, আর
 *    COD-র টাকার হিসাবও ঘেঁটে দিতে পারে। তাই key কখনো response-এ
 *    ফেরে না, আর DB-তে এনক্রিপ্ট করা থাকে।
 *
 * ২. **ভুয়া webhook।** secret ছাড়া webhook নিলে যে কেউ
 *    "DELIVERED" পাঠিয়ে অর্ডার ডেলিভারড দেখাত, আর COD-র টাকা না
 *    পেয়েই হিসাব মিলে যেত।
 */
describe('Courier', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const adminEmail = `courier-admin-${stamp}@test.local`;
  const buyerEmail = `courier-buyer-${stamp}@test.local`;
  const password = 'secret123';

  let adminToken = '';
  let buyerToken = '';

  const categorySlug = `courier-cat-${stamp}`;
  const productSlug = `courier-product-${stamp}`;
  const sku = `SKU-CR-${stamp}`;

  const UNIT_PRICE_PAISA = 60_000;

  let variantId = '';

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  const address = {
    fullName: 'Courier Buyer',
    phone: `0171${String(stamp % 10_000_000).padStart(7, '0')}`,
    line1: 'House 7, Road 3',
    city: 'Dhaka',
    district: 'Dhaka',
  };

  /** অর্ডার বানিয়ে `PRINTED` পর্যন্ত এগিয়ে দেয় — কুরিয়ারে পাঠানোর আগের অবস্থা। */
  const placeOrderReadyToShip = async (): Promise<string> => {
    await request(app.getHttpServer())
      .post('/cart/items')
      .set(authed(buyerToken))
      .send({ variantId, quantity: 1 })
      .expect(201);

    const order = await request(app.getHttpServer())
      .post('/orders')
      .set(authed(buyerToken))
      .send({ address })
      .expect(201);

    const orderNumber: string = order.body.orderNumber;

    for (const toStatus of ['DESIGN_CONFIRMED', 'IN_PRODUCTION', 'PRINTED']) {
      await request(app.getHttpServer())
        .patch(`/admin/orders/${orderNumber}/status`)
        .set(authed(adminToken))
        .send({ toStatus })
        .expect(200);
    }

    return orderNumber;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: adminEmail, password, name: 'Courier Admin' })
      .expect(201);

    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'SUPER_ADMIN' } });

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = adminLogin.body.accessToken;

    const buyer = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: buyerEmail, password, name: 'Courier Buyer' })
      .expect(201);
    buyerToken = buyer.body.accessToken;

    const category = await request(app.getHttpServer())
      .post('/admin/categories')
      .set(authed(adminToken))
      .send({ name: 'Courier Cat', slug: categorySlug })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/admin/products')
      .set(authed(adminToken))
      .send({
        name: 'Courier Product',
        slug: productSlug,
        categoryId: category.body.id,
        isPublished: true,
        variants: [{ sku, pricePaisa: UNIT_PRICE_PAISA, stock: 500 }],
      })
      .expect(201);

    variantId = product.body.variants[0].id;
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: [adminEmail, buyerEmail] } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.product.deleteMany({ where: { slug: productSlug } });
    await prisma.category.deleteMany({ where: { slug: categorySlug } });
    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, buyerEmail] } } });

    /**
     * টেস্টে বানানো কুরিয়ার অ্যাকাউন্ট মুছে ফেলা — কিন্তু `MANUAL`
     * **রেখে দেওয়া হয়**। ওটা migration-এ আসে, টেস্টের সম্পত্তি নয়;
     * মুছে ফেললে পরের suite-গুলো কুরিয়ার ছাড়া পড়ে থাকত।
     */
    await prisma.courierAccount.deleteMany({ where: { kind: { not: 'MANUAL' } } });
    await app.close();
  });

  describe('a fresh install can already ship', () => {
    /**
     * **সবচেয়ে দরকারি টেস্ট।** যে ব্যবসায়ী কোড কিনে শুধু
     * `db:deploy` চালাল, তার দোকানে `MANUAL` কুরিয়ার আগেই থাকতে
     * হবে। না থাকলে অর্ডার নিতে পারত, কিন্তু "পাঠানো হয়েছে" বলার
     * কোনো উপায় থাকত না — আর কারণটাও বোঝা যেত না।
     */
    it('has a manual courier out of the box', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/couriers')
        .set(authed(adminToken))
        .expect(200);

      const manual = response.body.find(
        (account: { kind: string }) => account.kind === 'MANUAL',
      );

      expect(manual).toBeDefined();
      expect(manual.isActive).toBe(true);
      // নিজের ডেলিভারিতে কোনো key লাগে না
      expect(manual.missingFields).toEqual([]);
    });
  });

  describe('keeping the API keys secret', () => {
    /**
     * **key কখনো response-এ ফেরে না** — শুধু শেষ ৪ অক্ষর।
     *
     * প্যানেলে key দেখানোর দরকার নেই, শুধু "ঠিকটা বসানো আছে কি না"
     * মেলানোর দরকার। পুরো key ফেরালে ব্রাউজারের history, log, আর
     * যে কেউ কাঁধের উপর দিয়ে দেখলেই ফাঁস হতো।
     */
    it('never returns a key it was given', async () => {
      const apiKey = `sf-key-${stamp}-abcd`;
      const secretKey = `sf-secret-${stamp}-wxyz`;

      const created = await request(app.getHttpServer())
        .post('/admin/couriers')
        .set(authed(adminToken))
        .send({
          kind: 'STEADFAST',
          label: 'Steadfast',
          credentials: { apiKey, secretKey },
        })
        .expect(201);

      const body = JSON.stringify(created.body);

      expect(body).not.toContain(apiKey);
      expect(body).not.toContain(secretKey);

      // শেষ ৪ অক্ষর দেখানো হয়, যাতে অ্যাডমিন মেলাতে পারে
      expect(created.body.credentialHints.apiKey).toBe('••••abcd');
      expect(created.body.credentialHints.secretKey).toBe('••••wxyz');
    });

    /**
     * **DB-তে key এনক্রিপ্ট করা থাকে।**
     *
     * DB backup, `pg_dump`, বা শুধু read access — তিনটাই সাধারণ
     * ঘটনা। সাধারণভাবে রাখলে এগুলোর যেকোনোটাতে key পড়া যেত।
     */
    it('stores the key encrypted, not in plain text', async () => {
      const apiKey = `plain-check-${stamp}`;

      await request(app.getHttpServer())
        .post('/admin/couriers')
        .set(authed(adminToken))
        .send({
          kind: 'REDX',
          label: 'RedX',
          credentials: { accessToken: apiKey, pickupStoreId: '42' },
        })
        .expect(201);

      const row = await prisma.courierAccount.findUniqueOrThrow({ where: { kind: 'REDX' } });

      expect(row.credentials).not.toBeNull();
      expect(row.credentials).not.toContain(apiKey);
      // `iv:tag:payload` — এনক্রিপ্ট করার চিহ্ন
      expect(row.credentials?.split(':')).toHaveLength(3);
    });

    /** webhook secret-ও একইভাবে — ওটা দিয়েই ভুয়া webhook বানানো যায়। */
    it('stores the webhook secret encrypted', async () => {
      const secret = `webhook-secret-${stamp}`;

      await request(app.getHttpServer())
        .post('/admin/couriers')
        .set(authed(adminToken))
        .send({
          kind: 'CARRYBEE',
          label: 'Carrybee',
          credentials: { clientId: 'cid', clientSecret: 'csec', clientContext: 'ctx' },
          webhookSecret: secret,
        })
        .expect(201);

      const row = await prisma.courierAccount.findUniqueOrThrow({ where: { kind: 'CARRYBEE' } });

      expect(row.webhookSecret).not.toContain(secret);
      expect(row.webhookSecret?.split(':')).toHaveLength(3);
    });

    /** শুধু মালিক — কুরিয়ারের key দিয়ে টাকার হিসাব বদলানো যায়। */
    it('keeps a customer out of the courier settings', async () => {
      await request(app.getHttpServer())
        .get('/admin/couriers')
        .set(authed(buyerToken))
        .expect(403);
    });
  });

  describe('setting up a courier', () => {
    /**
     * দরকারি মাঠ বাদ পড়লে **তখনই** ধরা পড়তে হবে।
     *
     * না ধরলে ভুলটা প্রথম পার্সেল পাঠানোর সময় বেরিয়ে আসত —
     * অর্থাৎ ক্রেতা অপেক্ষা করছে এমন মুহূর্তে।
     */
    it('refuses credentials with a missing field', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/couriers')
        .set(authed(adminToken))
        .send({
          kind: 'PATHAO',
          label: 'Pathao',
          credentials: { clientId: 'only-this' },
        })
        .expect(400);

      expect(JSON.stringify(response.body)).toContain('clientSecret');
    });

    /**
     * অপ্রয়োজনীয় মাঠও আটকানো হয় — বানান ভুল এভাবেই ধরা পড়ে।
     *
     * চুপচাপ ফেলে দিলে অ্যাডমিন ভাবত `apikey` সংরক্ষিত হয়েছে আর
     * কাজ করছে, অথচ `apiKey` খালি।
     */
    it('refuses a credential field the courier does not use', async () => {
      await request(app.getHttpServer())
        .post('/admin/couriers')
        .set(authed(adminToken))
        .send({
          kind: 'STEADFAST',
          label: 'Typo',
          credentials: { apiKey: 'a', secretKey: 'b', apikey: 'typo' },
        })
        .expect(400);
    });

    /** এক কুরিয়ারের দুটো অ্যাকাউন্ট নয় — কোনটা চলবে বলা যেত না। */
    it('refuses a second account for the same courier', async () => {
      await request(app.getHttpServer())
        .post('/admin/couriers')
        .set(authed(adminToken))
        .send({ kind: 'MANUAL', label: 'Another manual' })
        .expect(409);
    });

    /**
     * key ছাড়াই অ্যাকাউন্ট বানানো যায় — পরে বসানো হবে।
     *
     * চুক্তি চলছে কিন্তু key এখনো আসেনি, এই অবস্থা স্বাভাবিক।
     * তখন অ্যাকাউন্টটা **চালু করা যাবে না**, সেটা আলাদা টেস্টে।
     */
    it('allows an account with no key yet', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/couriers')
        .set(authed(adminToken))
        .send({ kind: 'PATHAO', label: 'Pathao (pending)' })
        .expect(201);

      expect(response.body.isActive).toBe(false);
      expect(response.body.missingFields).toContain('clientId');
    });

    /**
     * **key ছাড়া চালু করা যাবে না।**
     *
     * চালু করতে দিলে সেটা ডিফল্ট হয়ে বসত আর প্রতিটা অর্ডার
     * পাঠানোর চেষ্টায় ব্যর্থ হতো — অথচ প্যানেলে সব ঠিক দেখাত।
     */
    it('refuses to activate an account with no key', async () => {
      const accounts = await request(app.getHttpServer())
        .get('/admin/couriers')
        .set(authed(adminToken))
        .expect(200);

      const pathao = accounts.body.find((a: { kind: string }) => a.kind === 'PATHAO');

      await request(app.getHttpServer())
        .patch(`/admin/couriers/${pathao.id}`)
        .set(authed(adminToken))
        .send({ isActive: true })
        .expect(400);
    });

    /**
     * আপডেটে **যা পাঠানো হয়নি তা অপরিবর্তিত থাকে**।
     *
     * Zod-এ `.partial()` default সরায় না, তাই শুধু `{ label }`
     * পাঠালেও key মুছে যেতে পারত। Phase 14 আর 15-এ ঠিক এই বাগটাই
     * ধরা পড়েছিল, তাই এখানে আলাদা করে যাচাই করা হয়।
     */
    it('keeps the key when only the label is updated', async () => {
      const accounts = await request(app.getHttpServer())
        .get('/admin/couriers')
        .set(authed(adminToken))
        .expect(200);

      const redx = accounts.body.find((a: { kind: string }) => a.kind === 'REDX');
      const before = redx.credentialHints.accessToken;

      const updated = await request(app.getHttpServer())
        .patch(`/admin/couriers/${redx.id}`)
        .set(authed(adminToken))
        .send({ label: 'RedX (renamed)' })
        .expect(200);

      expect(updated.body.label).toBe('RedX (renamed)');
      expect(updated.body.credentialHints.accessToken).toBe(before);
    });

    /** ডিফল্ট ঠিক একটাই — নইলে কোন কুরিয়ারে যাবে বলা যেত না। */
    it('moves the default instead of having two', async () => {
      const accounts = await request(app.getHttpServer())
        .get('/admin/couriers')
        .set(authed(adminToken))
        .expect(200);

      const steadfast = accounts.body.find((a: { kind: string }) => a.kind === 'STEADFAST');

      await request(app.getHttpServer())
        .patch(`/admin/couriers/${steadfast.id}`)
        .set(authed(adminToken))
        .send({ isActive: true, isDefault: true })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get('/admin/couriers')
        .set(authed(adminToken))
        .expect(200);

      const defaults = after.body.filter((a: { isDefault: boolean }) => a.isDefault);

      expect(defaults).toHaveLength(1);
      expect(defaults[0].kind).toBe('STEADFAST');
    });
  });

  describe('sending an order to the courier', () => {
    /**
     * `MANUAL`-এ পার্সেল তৈরি হয় কিন্তু কোথাও কিছু পাঠানো হয় না।
     *
     * এটাই ছোট দোকানের আসল পথ: নিজের লোক পণ্য নিয়ে যায়, অ্যাডমিন
     * প্যানেলে হাতে অবস্থা বদলায়।
     */
    it('creates a parcel with the manual courier', async () => {
      const orderNumber = await placeOrderReadyToShip();

      const response = await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/dispatch`)
        .set(authed(adminToken))
        .send({ courier: 'MANUAL', trackingCode: 'OWN-RIDER-01' })
        .expect(201);

      expect(response.body.courier).toBe('MANUAL');
      expect(response.body.trackingCode).toBe('OWN-RIDER-01');
      expect(response.body.status).toBe('PENDING');
      // COD — পেমেন্ট হয়নি, তাই কুরিয়ার পুরো টাকা তুলবে
      expect(response.body.codAmountPaisa).toBeGreaterThan(0);
    });

    /**
     * পার্সেল তৈরি হলে অর্ডার **`SHIPPED`** হয়ে যায়।
     *
     * আলাদা করে অবস্থা বদলাতে হলে অ্যাডমিন একটা ভুলে যেত, আর
     * ক্রেতা ট্র্যাকিং পাতায় "ছাপা হয়েছে" দেখে ভাবত পাঠানো হয়নি।
     */
    it('marks the order shipped', async () => {
      const orderNumber = await placeOrderReadyToShip();

      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/dispatch`)
        .set(authed(adminToken))
        .send({ courier: 'MANUAL' })
        .expect(201);

      const order = await request(app.getHttpServer())
        .get(`/admin/orders/${orderNumber}`)
        .set(authed(adminToken))
        .expect(200);

      expect(order.body.status).toBe('SHIPPED');
    });

    /**
     * **একই অর্ডার দুবার পাঠানো যাবে না।**
     *
     * দুবার পাঠালে দুটো পার্সেল যেত, দুজন রাইডার একই ঠিকানায়
     * হাজির হতো, আর COD-র টাকা দুবার তোলার চেষ্টা হতো।
     */
    it('refuses to dispatch the same order twice', async () => {
      const orderNumber = await placeOrderReadyToShip();

      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/dispatch`)
        .set(authed(adminToken))
        .send({ courier: 'MANUAL' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/dispatch`)
        .set(authed(adminToken))
        .send({ courier: 'MANUAL' })
        .expect(409);
    });

    /**
     * ছাপা হওয়ার আগে পাঠানো যাবে না।
     *
     * পণ্য তৈরি না হতেই রাইডার পাঠালে সে খালি হাতে ফিরত, আর
     * কুরিয়ারের খরচটা জলে যেত।
     */
    it('refuses to dispatch an order that is not printed yet', async () => {
      await request(app.getHttpServer())
        .post('/cart/items')
        .set(authed(buyerToken))
        .send({ variantId, quantity: 1 })
        .expect(201);

      const order = await request(app.getHttpServer())
        .post('/orders')
        .set(authed(buyerToken))
        .send({ address })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/admin/orders/${order.body.orderNumber}/dispatch`)
        .set(authed(adminToken))
        .send({ courier: 'MANUAL' })
        .expect(409);
    });

    /** API-ওয়ালা কুরিয়ারে ট্র্যাকিং নম্বর হাতে বসানো যায় না — তারাই দেয়। */
    it('refuses a hand-typed tracking code for an API courier', async () => {
      const orderNumber = await placeOrderReadyToShip();

      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/dispatch`)
        .set(authed(adminToken))
        .send({ courier: 'STEADFAST', trackingCode: 'MADE-UP' })
        .expect(400);
    });

    /** বন্ধ কুরিয়ারে পাঠানো যাবে না। */
    it('refuses an inactive courier', async () => {
      const orderNumber = await placeOrderReadyToShip();

      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/dispatch`)
        .set(authed(adminToken))
        .send({ courier: 'CARRYBEE' })
        .expect(400);
    });

    /** শুধু মালিক — পার্সেল পাঠানো মানে টাকা আর পণ্য দুটোই নড়ে। */
    it('keeps a customer from dispatching', async () => {
      const orderNumber = await placeOrderReadyToShip();

      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/dispatch`)
        .set(authed(buyerToken))
        .send({ courier: 'MANUAL' })
        .expect(403);
    });
  });

  describe('updating a parcel by hand', () => {
    /** `MANUAL` কুরিয়ারে এটাই একমাত্র পথ — webhook পাঠানোর কেউ নেই। */
    it('lets the admin move a manual parcel forward', async () => {
      const orderNumber = await placeOrderReadyToShip();

      const dispatched = await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/dispatch`)
        .set(authed(adminToken))
        .send({ courier: 'MANUAL' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .patch(`/admin/shipments/${dispatched.body.id}/status`)
        .set(authed(adminToken))
        .send({ status: 'DELIVERED', note: 'রাইডার পৌঁছে দিয়েছে' })
        .expect(200);

      expect(response.body.status).toBe('DELIVERED');

      // অর্ডারও সাথে সাথে `DELIVERED` — দুই জায়গায় আলাদা থাকলে হিসাব মিলত না
      const order = await request(app.getHttpServer())
        .get(`/admin/orders/${orderNumber}`)
        .set(authed(adminToken))
        .expect(200);

      expect(order.body.status).toBe('DELIVERED');
    });

    /**
     * **পৌঁছে যাওয়া পার্সেল পিছিয়ে যাবে না।**
     *
     * webhook ক্রমে আসে না — দেরিতে আসা "IN_TRANSIT" পরে এলে
     * পার্সেল পিছিয়ে যেত আর অ্যাডমিন ভাবত হারিয়ে গেছে।
     */
    it('refuses to move a delivered parcel backwards', async () => {
      const orderNumber = await placeOrderReadyToShip();

      const dispatched = await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/dispatch`)
        .set(authed(adminToken))
        .send({ courier: 'MANUAL' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/admin/shipments/${dispatched.body.id}/status`)
        .set(authed(adminToken))
        .send({ status: 'DELIVERED' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/admin/shipments/${dispatched.body.id}/status`)
        .set(authed(adminToken))
        .send({ status: 'IN_TRANSIT' })
        .expect(409);
    });

    /**
     * ফেরত এলে অর্ডার বাতিল **হয় না**।
     *
     * ফেরত মানে ক্রেতা নেয়নি, কিন্তু পণ্য দোকানে ফিরেছে আর
     * টাকার হিসাব এখনো বাকি। রিফান্ড? আবার পাঠানো? সিদ্ধান্তটা
     * মানুষের, তাই অর্ডার যেমন ছিল তেমনই থাকে।
     */
    it('does not cancel the order when a parcel comes back', async () => {
      const orderNumber = await placeOrderReadyToShip();

      const dispatched = await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/dispatch`)
        .set(authed(adminToken))
        .send({ courier: 'MANUAL' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/admin/shipments/${dispatched.body.id}/status`)
        .set(authed(adminToken))
        .send({ status: 'RETURNED', failureReason: 'ফোন বন্ধ' })
        .expect(200);

      const order = await request(app.getHttpServer())
        .get(`/admin/orders/${orderNumber}`)
        .set(authed(adminToken))
        .expect(200);

      // অর্ডার `SHIPPED`-এই থাকে — অ্যাডমিন সিদ্ধান্ত নেবে
      expect(order.body.status).toBe('SHIPPED');
    });

    /** প্রতিটা বদল ইতিহাসে জমা — দেরির অভিযোগে কুরিয়ারকে দেখানো যায়। */
    it('records every change as an event', async () => {
      const orderNumber = await placeOrderReadyToShip();

      const dispatched = await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/dispatch`)
        .set(authed(adminToken))
        .send({ courier: 'MANUAL' })
        .expect(201);

      for (const status of ['PICKED_UP', 'IN_TRANSIT', 'DELIVERED']) {
        await request(app.getHttpServer())
          .patch(`/admin/shipments/${dispatched.body.id}/status`)
          .set(authed(adminToken))
          .send({ status })
          .expect(200);
      }

      const events = await prisma.shipmentEvent.count({
        where: { shipmentId: dispatched.body.id },
      });

      // তৈরির মুহূর্তটাও ইতিহাসে আছে
      expect(events).toBeGreaterThanOrEqual(4);
    });
  });

  describe('the customer can see where the parcel is', () => {
    /**
     * ট্র্যাকিং পাতায় কুরিয়ারের নাম আর নম্বর দেখা যায়।
     *
     * **কিন্তু আমাদের ভেতরের আইডি নয়** — `consignmentId` দিয়ে
     * কুরিয়ারের API-তে কল করা যায়, তাই সেটা বাইরে যাবে না।
     */
    it('shows the courier and tracking code, not internal ids', async () => {
      const orderNumber = await placeOrderReadyToShip();

      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/dispatch`)
        .set(authed(adminToken))
        .send({ courier: 'MANUAL', trackingCode: 'TRK-999' })
        .expect(201);

      const tracked = await request(app.getHttpServer())
        .post('/track')
        .send({ orderNumber, phone: address.phone })
        .expect(200);

      expect(tracked.body.shipment.courier).toBe('MANUAL');
      expect(tracked.body.shipment.trackingCode).toBe('TRK-999');
      expect(JSON.stringify(tracked.body)).not.toContain('courierAccountId');
    });

    /** পাঠানোর আগে `shipment` `null` — ভুয়া তথ্য দেখানোর চেয়ে কিছু না দেখানো ভালো। */
    it('shows no shipment before dispatch', async () => {
      await request(app.getHttpServer())
        .post('/cart/items')
        .set(authed(buyerToken))
        .send({ variantId, quantity: 1 })
        .expect(201);

      const order = await request(app.getHttpServer())
        .post('/orders')
        .set(authed(buyerToken))
        .send({ address })
        .expect(201);

      const tracked = await request(app.getHttpServer())
        .post('/track')
        .send({ orderNumber: order.body.orderNumber, phone: address.phone })
        .expect(200);

      expect(tracked.body.shipment).toBeNull();
    });
  });

  describe('removing a courier', () => {
    /**
     * **নিজের ডেলিভারি মোছা যায় না।**
     *
     * ওটা migration-এ আসে আর key ছাড়া চলে, তাই শেষ ভরসা। মুছে
     * ফেললে key-হীন দোকান কিছুই পাঠাতে পারত না — আর ফিরিয়ে আনার
     * কোনো বাটনও থাকত না।
     */
    it('refuses to remove the manual courier', async () => {
      const accounts = await request(app.getHttpServer())
        .get('/admin/couriers')
        .set(authed(adminToken))
        .expect(200);

      const manual = accounts.body.find((a: { kind: string }) => a.kind === 'MANUAL');

      await request(app.getHttpServer())
        .delete(`/admin/couriers/${manual.id}`)
        .set(authed(adminToken))
        .expect(400);
    });

    /**
     * পার্সেল পাঠানো হয়ে গেলে মোছা যায় না — ইতিহাস হারাত।
     *
     * কোন অর্ডার কোন কুরিয়ারে গিয়েছিল সেটা পরে দরকার হয়: বিল
     * মেলানো, দেরির অভিযোগ, ফেরতের হিসাব।
     */
    it('refuses to remove a courier that has shipments', async () => {
      /**
       * `CARRYBEE` আগের টেস্টে key সহ তৈরি হয়েছে। এখানে চালু করে
       * একটা পার্সেল পাঠিয়ে তারপর মোছার চেষ্টা করা হয় — কারণ
       * `MANUAL` অন্য নিয়মে আটকায় (কখনো মোছা যায় না), আর তাহলে
       * এই নিয়মটা পরীক্ষাই হতো না।
       */
      const accounts = await request(app.getHttpServer())
        .get('/admin/couriers')
        .set(authed(adminToken))
        .expect(200);

      const carrybee = accounts.body.find((a: { kind: string }) => a.kind === 'CARRYBEE');

      const order = await placeOrderReadyToShip();

      /**
       * Carrybee-র adapter এখনো নেই, তাই পার্সেল সরাসরি DB-তে
       * বসানো হয় — মোছার নিয়মটা adapter-নিরপেক্ষ, আর সেটাই এখানে
       * পরীক্ষা করা হচ্ছে।
       */
      const orderRow = await prisma.order.findUniqueOrThrow({
        where: { orderNumber: order },
        select: { id: true },
      });

      await prisma.shipment.create({
        data: {
          orderId: orderRow.id,
          courierAccountId: carrybee.id,
          courier: 'CARRYBEE',
          consignmentId: `CB-${stamp}`,
        },
      });

      await request(app.getHttpServer())
        .delete(`/admin/couriers/${carrybee.id}`)
        .set(authed(adminToken))
        .expect(400);
    });

    /**
     * পার্সেল যায়নি এমন কুরিয়ার মোছা যায় — ভুল করে বানালে সরানো দরকার।
     *
     * `PATHAO` আগের টেস্টে তৈরি হয়েছে কিন্তু key বসানো হয়নি, তাই
     * কোনো পার্সেল যায়নি — মোছার জন্য ঠিক অবস্থা।
     */
    it('removes a courier with no shipments', async () => {
      const accounts = await request(app.getHttpServer())
        .get('/admin/couriers')
        .set(authed(adminToken))
        .expect(200);

      const pathao = accounts.body.find((a: { kind: string }) => a.kind === 'PATHAO');

      expect(pathao).toBeDefined();

      await request(app.getHttpServer())
        .delete(`/admin/couriers/${pathao.id}`)
        .set(authed(adminToken))
        .expect(204);

      const after = await prisma.courierAccount.findUnique({ where: { kind: 'PATHAO' } });

      expect(after).toBeNull();
    });

    it('returns 404 for a courier that does not exist', async () => {
      await request(app.getHttpServer())
        .delete('/admin/couriers/nosuchid')
        .set(authed(adminToken))
        .expect(404);
    });
  });

  describe('the courier webhook', () => {
    /**
     * **secret ছাড়া webhook নেওয়া হয় না।**
     *
     * নিলে যে কেউ "DELIVERED" পাঠিয়ে অর্ডার ডেলিভারড দেখাত, আর
     * COD-র টাকা না পেয়েই হিসাব মিলে যেত। ভুয়া রিটার্নও পাঠানো
     * যেত, যা ক্রেতার ঝুঁকির স্কোর নষ্ট করত।
     */
    it('refuses a webhook for a courier with no secret set', async () => {
      await request(app.getHttpServer())
        .post('/courier-webhook/steadfast')
        .send({ consignment_id: 'anything', status: 'delivered' })
        .expect(401);
    });

    /** অজানা কুরিয়ারের webhook — ৪০৪, কারণ আমরা ওটা সেটআপই করিনি। */
    it('refuses a webhook for an unknown courier', async () => {
      await request(app.getHttpServer())
        .post('/courier-webhook/notacourier')
        .send({})
        .expect(404);
    });
  });
});
