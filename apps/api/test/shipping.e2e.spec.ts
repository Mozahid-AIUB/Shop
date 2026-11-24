import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * ডেলিভারি চার্জ — অ্যাডমিন প্যানেল থেকে বদলানো, আর ক্রেতার quote।
 *
 * **এখানে ভুলের দাম:** চার্জ ভুল করে ০ হয়ে গেলে প্রতি অর্ডারে
 * লোকসান, অথচ অর্ডার সফলই দেখায় — কেউ টের পায় না। তাই
 * "default zone সবসময় থাকবে" নিয়মটা আলাদা করে যাচাই করা হয়।
 */
describe('Shipping zones', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const adminEmail = `sz-admin-${stamp}@test.local`;
  const buyerEmail = `sz-buyer-${stamp}@test.local`;
  const password = 'secret123';

  let adminToken = '';
  let buyerToken = '';

  /** টেস্টের তৈরি zone-গুলো — শেষে মুছে ফেলা হয়। */
  const createdZoneIds: string[] = [];

  /**
   * suite শুরুর সময় যে zone default ছিল।
   *
   * default সরানোর টেস্টের পর ঠিক এটাকেই ফেরত বসানো হয়, যাতে পরের
   * suite-গুলো default ছাড়া DB না পায়।
   */
  let previousDefaultId: string | null = null;

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  const makeUser = async (email: string, role?: string): Promise<string> => {
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Shipping Test' })
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

  /**
   * zone তৈরি করে।
   *
   * `sortOrder: 0` দেওয়া হয় যাতে seed-এর zone-গুলোর **আগে** বিবেচিত
   * হয় — `findZoneForDistrict` প্রথম মিলটাই নেয়, তাই ক্রম গুরুত্বপূর্ণ।
   */
  const createZone = async (
    body: Record<string, unknown>,
    expectStatus = 201,
  ): Promise<{ status: number; body: Record<string, string> }> => {
    const response = await request(app.getHttpServer())
      .post('/admin/shipping-zones')
      .set(authed(adminToken))
      .send({ sortOrder: 0, ...body })
      .expect(expectStatus);

    if (response.status === 201 && typeof response.body.id === 'string') {
      createdZoneIds.push(response.body.id);
    }

    return response;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    adminToken = await makeUser(adminEmail, 'SUPER_ADMIN');
    buyerToken = await makeUser(buyerEmail);

    const current = await prisma.shippingZone.findFirst({ where: { isDefault: true } });

    previousDefaultId = current?.id ?? null;
  });

  afterAll(async () => {
    await prisma.shippingZone.deleteMany({ where: { id: { in: createdZoneIds } } });

    /**
     * শেষ রক্ষা: DB-তে ঠিক একটা default আছে কিনা নিশ্চিত করা।
     *
     * উপরের টেস্টগুলো নিজেরাই ফেরত বসায়, কিন্তু কোনোটা মাঝপথে
     * ব্যর্থ হলে default ছাড়াই থেকে যেতে পারত — তখন পরের suite-এর
     * প্রতিটা checkout 500 দিত আর আসল কারণ খুঁজতে অনেক সময় যেত।
     */
    const defaults = await prisma.shippingZone.count({ where: { isDefault: true } });

    if (defaults === 0) {
      const survivor = await prisma.shippingZone.findFirst({ orderBy: { createdAt: 'asc' } });

      if (survivor !== null) {
        await prisma.shippingZone.update({
          where: { id: survivor.id },
          data: { isDefault: true },
        });
      }
    }

    await prisma.user.deleteMany({ where: { email: { in: [adminEmail, buyerEmail] } } });
    await app.close();
  });

  describe('who may change the charges', () => {
    /** চার্জ বদলানো সরাসরি আয়ে প্রভাব ফেলে — তাই শুধু মালিক। */
    it('keeps a customer out of the admin endpoints', async () => {
      await request(app.getHttpServer())
        .get('/admin/shipping-zones')
        .set(authed(buyerToken))
        .expect(403);
    });

    it('refuses an anonymous caller', async () => {
      await request(app.getHttpServer()).get('/admin/shipping-zones').expect(401);
    });
  });

  describe('quoting for the cart', () => {
    /** ক্রেতা অ্যাকাউন্ট খোলার আগেই চার্জ জানতে চায়। */
    it('answers without a login', async () => {
      const response = await request(app.getHttpServer())
        .get('/shipping/quote?district=Dhaka&subtotalPaisa=50000')
        .expect(200);

      expect(response.body.chargePaisa).toBeGreaterThan(0);
      expect(response.body.zoneName).toBeDefined();
    });

    /** জেলা free text — ছোট হাতে লিখলেও একই চার্জ পড়া উচিত। */
    it('matches a district whatever the casing', async () => {
      const quotes = await Promise.all(
        ['Dhaka', 'dhaka', 'DHAKA'].map((district) =>
          request(app.getHttpServer())
            .get(`/shipping/quote?district=${district}&subtotalPaisa=50000`)
            .expect(200),
        ),
      );

      const zoneIds = quotes.map((quote) => quote.body.zoneId);

      // তিনটেই একই zone-এ পড়েছে
      expect(new Set(zoneIds).size).toBe(1);
    });

    /** অচেনা জেলা default zone-এ পড়বে, চার্জ ০ হবে না। */
    it('still charges for a district nobody configured', async () => {
      const response = await request(app.getHttpServer())
        .get('/shipping/quote?district=Bandarban&subtotalPaisa=50000')
        .expect(200);

      expect(response.body.chargePaisa).toBeGreaterThan(0);
    });

    it('rejects a request with no district', async () => {
      await request(app.getHttpServer())
        .get('/shipping/quote?subtotalPaisa=50000')
        .expect(400);
    });
  });

  describe('free delivery is decided by the admin', () => {
    it('gives free delivery above the threshold the admin set', async () => {
      const zone = await createZone({
        name: `Free Zone ${stamp}`,
        districts: [`FreeTestDistrict${stamp}`],
        chargePaisa: 7_000,
        freeAbovePaisa: 100_000,
      });

      const below = await request(app.getHttpServer())
        .get(`/shipping/quote?district=FreeTestDistrict${stamp}&subtotalPaisa=99999`)
        .expect(200);

      const above = await request(app.getHttpServer())
        .get(`/shipping/quote?district=FreeTestDistrict${stamp}&subtotalPaisa=100000`)
        .expect(200);

      expect(zone.body.id).toBeDefined();
      expect(below.body.chargePaisa).toBe(7_000);
      expect(below.body.isFree).toBe(false);
      // "আর ১ পয়সার কিনলে ফ্রি" — কার্টে এটা দেখানো যায়
      expect(below.body.freeAfterPaisa).toBe(1);

      expect(above.body.chargePaisa).toBe(0);
      expect(above.body.isFree).toBe(true);
    });

    /** `freeAbovePaisa: null` মানে এই এলাকায় ফ্রি দেওয়া হবে না। */
    it('never gives free delivery where the admin disabled it', async () => {
      await createZone({
        name: `No Free Zone ${stamp}`,
        districts: [`NoFreeDistrict${stamp}`],
        chargePaisa: 15_000,
        freeAbovePaisa: null,
      });

      const response = await request(app.getHttpServer())
        .get(`/shipping/quote?district=NoFreeDistrict${stamp}&subtotalPaisa=9999999`)
        .expect(200);

      expect(response.body.chargePaisa).toBe(15_000);
      expect(response.body.isFree).toBe(false);
    });

    it('lets the admin change a charge afterwards', async () => {
      const zone = await createZone({
        name: `Editable Zone ${stamp}`,
        districts: [`EditDistrict${stamp}`],
        chargePaisa: 5_000,
      });

      await request(app.getHttpServer())
        .patch(`/admin/shipping-zones/${zone.body.id}`)
        .set(authed(adminToken))
        .send({ chargePaisa: 9_000 })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get(`/shipping/quote?district=EditDistrict${stamp}&subtotalPaisa=10000`)
        .expect(200);

      // নিজের zone-এই পড়েছে কিনা আগে নিশ্চিত হও — অন্য zone-এ পড়লে
      // চার্জ মিলবে না আর ভুল কারণ খুঁজতে হতো
      expect(response.body.zoneId).toBe(zone.body.id);
      expect(response.body.chargePaisa).toBe(9_000);
    });

    /**
     * **একটা আসল bug এখানে ধরা পড়েছিল।** আপডেটের schema
     * `.partial()` দিয়ে বানানো ছিল, আর Zod-এ `.partial()` মাঠ
     * ঐচ্ছিক করে কিন্তু `.default()` সরায় না। ফলে শুধু চার্জ
     * পাঠালেও জেলার তালিকা `[]` হয়ে মুছে যেত — অ্যাডমিন চার্জ
     * বদলাতে গিয়ে অজান্তে পুরো এলাকাটা ভেঙে ফেলত।
     */
    it('keeps the districts when only the charge is changed', async () => {
      const zone = await createZone({
        name: `Keep Districts ${stamp}`,
        districts: [`KeepDistrict${stamp}`],
        chargePaisa: 4_000,
      });

      await request(app.getHttpServer())
        .patch(`/admin/shipping-zones/${zone.body.id}`)
        .set(authed(adminToken))
        .send({ chargePaisa: 8_000 })
        .expect(200);

      const saved = await prisma.shippingZone.findUniqueOrThrow({
        where: { id: zone.body.id },
      });

      expect(saved.districts).toEqual([`KeepDistrict${stamp}`]);
      expect(saved.chargePaisa).toBe(8_000);
      // সক্রিয়তাও অপরিবর্তিত থাকতে হবে
      expect(saved.isActive).toBe(true);
    });
  });

  describe('the default zone cannot be removed', () => {
    /**
     * **সবচেয়ে গুরুত্বপূর্ণ সুরক্ষা।** default zone না থাকলে অচেনা
     * জেলার ক্রেতার checkout ভেঙে পড়ত — আর সেটা ধরা পড়ত কেবল
     * আসল ক্রেতা চেষ্টা করার সময়, বিক্রি হারানোর পর।
     */
    it('refuses to delete it', async () => {
      const current = await prisma.shippingZone.findFirst({ where: { isDefault: true } });

      expect(current).not.toBeNull();

      await request(app.getHttpServer())
        .delete(`/admin/shipping-zones/${current?.id}`)
        .set(authed(adminToken))
        .expect(400);
    });

    it('refuses to simply unset it', async () => {
      const current = await prisma.shippingZone.findFirst({ where: { isDefault: true } });

      await request(app.getHttpServer())
        .patch(`/admin/shipping-zones/${current?.id}`)
        .set(authed(adminToken))
        .send({ isDefault: false })
        .expect(400);
    });

    /** কিন্তু অন্যটাকে default করা যাবে — তখন পুরোনোটা নেমে যায়। */
    it('moves the default to another zone, leaving exactly one', async () => {
      const zone = await createZone({
        name: `New Default ${stamp}`,
        districts: [],
        chargePaisa: 11_000,
        isDefault: true,
      });

      const defaults = await prisma.shippingZone.findMany({ where: { isDefault: true } });

      expect(defaults).toHaveLength(1);
      expect(defaults[0]?.id).toBe(zone.body.id);

      /**
       * আগের default-টা ফেরত দেওয়া হয়।
       *
       * **নাম দিয়ে খোঁজা হয় না।** আগে seed-এর `'ঢাকার বাইরে'` নামটা
       * খোঁজা হতো, কিন্তু seed ঐচ্ছিক — CI চালায় না। তখন zone-টা
       * পাওয়া যেত না, ফেরানো চুপচাপ বাদ পড়ত, আর cleanup-এ এই টেস্টের
       * zone মুছে গিয়ে DB-তে **একটাও default থাকত না**। ফলে পরের সব
       * checkout 500 দিত — আর কারণটা এই টেস্টে নয়, অন্য suite-এ ধরা
       * পড়ত। তাই শুরুতে যেটা default ছিল, সেটাকেই id দিয়ে ফেরানো হয়।
       */
      if (previousDefaultId !== null && previousDefaultId !== zone.body.id) {
        await request(app.getHttpServer())
          .patch(`/admin/shipping-zones/${previousDefaultId}`)
          .set(authed(adminToken))
          .send({ isDefault: true })
          .expect(200);

        const restored = await prisma.shippingZone.findMany({ where: { isDefault: true } });

        // ফেরানো সত্যিই হয়েছে কিনা — নইলে পরের suite ভাঙত
        expect(restored).toHaveLength(1);
        expect(restored[0]?.id).toBe(previousDefaultId);
      }
    });
  });

  describe('validation', () => {
    it('refuses a negative charge', async () => {
      await createZone({ name: 'Bad Zone', districts: [], chargePaisa: -100 }, 400);
    });

    it('refuses a zone with no name', async () => {
      await createZone({ districts: [], chargePaisa: 5_000 }, 400);
    });
  });
});
