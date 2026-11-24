import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Rate limit — এটাই একমাত্র suite যেখানে throttle **চালু** থাকে।
 *
 * বাকি suite-গুলো `THROTTLE_DISABLED=true` নিয়ে চলে, কারণ সেখানে
 * ইচ্ছাকৃতভাবে বারবার লগইন করা হয় (timing attack, token reuse)।
 * এখানে সেটা করা হয় না, তাই আসল সীমাই যাচাই হয়।
 */
describe('Rate limiting', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const email = `rl-user-${stamp}@test.local`;
  const password = 'secret123';

  beforeAll(async () => {
    // এই suite-এর জন্য সীমা ফিরিয়ে আনা — module তৈরির **আগে** বসাতে হবে,
    // কারণ throttler config module init-এর সময় একবারই পড়া হয়
    delete process.env.THROTTLE_DISABLED;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
    // অন্য suite-কে যেভাবে পেয়েছিল সেভাবেই ফিরিয়ে দাও
    process.env.THROTTLE_DISABLED = 'true';
  });

  /**
   * Monitoring `/health` প্রতি কয়েক সেকেন্ডে ডাকে — throttle করলে
   * uptime check নিজেই অ্যালার্ম বাজাতো।
   */
  it('leaves /health alone', async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await request(app.getHttpServer()).get('/health').expect(200);
    }
  });

  describe('login', () => {
    /**
     * ৫ বারের পর 429 — পাসওয়ার্ড অনুমান করা অসম্ভব করে তোলে।
     * ভুল পাসওয়ার্ডও গোনা হয়, নইলে brute force বিনামূল্যে চলত।
     */
    it('stops answering after a few attempts from the same caller', async () => {
      const statuses: number[] = [];

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: `nobody-${stamp}@test.local`, password: 'wrongpassword1' });

        statuses.push(response.status);
      }

      expect(statuses).toContain(429);
      // প্রথম চেষ্টাগুলো ৪০১ পায় — সীমা তার পরে কাজ করে
      expect(statuses[0]).toBe(401);
    });

    /**
     * সীমা ছাড়ালে কখন আবার চেষ্টা করা যাবে সেটা বলা হয়, যাতে
     * ক্লায়েন্ট অন্ধের মতো retry না করে।
     *
     * header-এ throttler-এর নাম জুড়ে যায় (`Retry-After-login`),
     * কারণ একই request-এ একাধিক নামওয়ালা সীমা থাকতে পারে।
     */
    it('tells the caller when to come back', async () => {
      // আগের টেস্টেই সীমা ছেড়ে গেছে, তাই এটা ৪২৯ পাবে
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `nobody-${stamp}@test.local`, password: 'wrongpassword1' })
        .expect(429);

      expect(response.headers['retry-after-login']).toBeDefined();
      expect(Number(response.headers['retry-after-login'])).toBeGreaterThan(0);
    });
  });

  describe('public order tracking', () => {
    /**
     * `/track` খোলা আর Order ID অনুমানযোগ্য (`ORD-2026-1123-018`) —
     * সীমা ছাড়া কেউ ০০১ থেকে গুনে সব অর্ডার বের করে ফেলত:
     * কে কী কিনেছে, কোথায় থাকে।
     */
    it('stops a caller walking through order numbers', async () => {
      const statuses: number[] = [];

      for (let serial = 1; serial <= 14; serial += 1) {
        const orderNumber = `ORD-2020-0101-${String(serial).padStart(3, '0')}`;

        const response = await request(app.getHttpServer())
          .post('/track')
          .send({ orderNumber, phone: '01712345678' });

        statuses.push(response.status);
      }

      expect(statuses).toContain(429);
      // শুরুতে 404 আসে (ওই অর্ডার নেই), সীমা তার পরে ধরে
      expect(statuses[0]).toBe(404);
    });
  });

  describe('register', () => {
    it('limits how many accounts one caller can open', async () => {
      const statuses: number[] = [];

      for (let attempt = 0; attempt < 13; attempt += 1) {
        const response = await request(app.getHttpServer())
          .post('/auth/register')
          .send({
            email: `rl-flood-${stamp}-${attempt}@test.local`,
            password,
            name: 'Flood Test',
          });

        statuses.push(response.status);
      }

      expect(statuses).toContain(429);
    });

    afterAll(async () => {
      await prisma.user.deleteMany({
        where: { email: { startsWith: `rl-flood-${stamp}-` } },
      });
    });
  });
});
