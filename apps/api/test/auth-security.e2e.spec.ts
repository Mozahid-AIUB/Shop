import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * আক্রমণের পথগুলো। সুখী পথ `auth.e2e.spec.ts`-এ।
 * এই ফাইলের প্রতিটা টেস্ট একটা করে বাস্তব ঝুঁকি আটকায়।
 */
describe('Auth security', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const email = `sec-${stamp}@test.local`;
  const password = 'secret123';
  const emails = [email, `sec-inactive-${stamp}@test.local`, `sec-role-${stamp}@test.local`];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Sec User' })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  describe('registration', () => {
    it('rejects a duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password, name: 'Someone Else' })
        .expect(409);
    });

    it('rejects a weak password', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: `weak-${stamp}@test.local`, password: 'short', name: 'Weak' })
        .expect(400);
    });

    it('rejects a malformed email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password, name: 'Bad' })
        .expect(400);
    });

    /**
     * সবচেয়ে বড় ঝুঁকি — কেউ `role: SUPER_ADMIN` পাঠিয়ে নিজেকে অ্যাডমিন বানাতে পারবে না।
     * হয় 400 (unknown field) নয় CUSTOMER হয়ে তৈরি হবে, কিন্তু কখনোই admin নয়।
     */
    it('ignores a role sent by the client — no privilege escalation', async () => {
      const escalationEmail = `escalate-${stamp}@test.local`;
      emails.push(escalationEmail);

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: escalationEmail, password, name: 'Sneaky', role: 'SUPER_ADMIN' });

      if (response.status === 201) {
        expect(response.body.user.role).toBe('CUSTOMER');

        const created = await prisma.user.findUnique({ where: { email: escalationEmail } });
        expect(created!.role).toBe('CUSTOMER');
      } else {
        expect(response.status).toBe(400);
      }
    });
  });

  describe('login', () => {
    it('rejects a wrong password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrongpassword1' })
        .expect(401);
    });

    it('rejects an unknown email', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `ghost-${stamp}@test.local`, password })
        .expect(401);
    });

    /**
     * User enumeration — ভুল পাসওয়ার্ড আর অজানা ইমেইল,
     * দুটোতেই হুবহু একই উত্তর আসতে হবে। নইলে কোন ইমেইল রেজিস্টার্ড তা জেনে নেওয়া যায়।
     */
    it('gives an identical answer for a wrong password and an unknown email', async () => {
      const wrongPassword = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrongpassword1' });

      const unknownEmail = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `ghost2-${stamp}@test.local`, password });

      expect(wrongPassword.status).toBe(unknownEmail.status);
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });

    it('blocks a deactivated account', async () => {
      const inactiveEmail = `sec-inactive-${stamp}@test.local`;

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: inactiveEmail, password, name: 'Inactive' })
        .expect(201);

      await prisma.user.update({
        where: { email: inactiveEmail },
        data: { isActive: false },
      });

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: inactiveEmail, password })
        .expect(401);
    });
  });

  describe('tokens', () => {
    it('rejects a garbage access token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('authorization', 'Bearer not.a.real.token')
        .expect(401);
    });

    it('rejects a token signed with the wrong secret', async () => {
      // অন্য secret দিয়ে বানানো, কাঠামো ঠিক কিন্তু signature ভুল
      const forged = [
        Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
        Buffer.from(JSON.stringify({ sub: 'x', role: 'SUPER_ADMIN' })).toString('base64url'),
        'forgedsignature',
      ].join('.');

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('authorization', `Bearer ${forged}`)
        .expect(401);
    });

    it('rejects a refresh call with no cookie', async () => {
      await request(app.getHttpServer()).post('/auth/refresh').expect(401);
    });

    it('rejects an unknown refresh token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', 'refreshToken=deadbeefdeadbeefdeadbeefdeadbeef')
        .expect(401);
    });

    /**
     * Reuse detection — মুছে ফেলা টোকেন আবার এলে ধরে নিতে হবে চুরি হয়েছে,
     * আর ওই ইউজারের **সব** সেশন মেরে ফেলতে হবে।
     */
    it('kills every session when a rotated token is replayed', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      const original = (login.get('Set-Cookie') ?? [])
        .find((c) => c.startsWith('refreshToken='))!
        .split(';')[0];

      const rotatedResponse = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', original)
        .expect(200);

      const rotated = (rotatedResponse.get('Set-Cookie') ?? [])
        .find((c) => c.startsWith('refreshToken='))!
        .split(';')[0];

      // চোর পুরোনোটা ব্যবহার করল
      await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', original).expect(401);

      // আসল ইউজারের নতুন টোকেনও এখন মরে গেছে — তাকে আবার লগইন করতে হবে
      await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', rotated).expect(401);

      const user = await prisma.user.findUnique({ where: { email } });
      const left = await prisma.refreshToken.count({ where: { userId: user!.id } });
      expect(left).toBe(0);
    });

    it('never puts the refresh token in the response body', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      expect(response.body.refreshToken).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('refreshToken');
    });
  });

  describe('RBAC', () => {
    it('keeps a customer out of staff-only routes', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      await request(app.getHttpServer())
        .get('/auth/admin-check')
        .set('authorization', `Bearer ${login.body.accessToken}`)
        .expect(403);
    });

    it('lets a staff member through', async () => {
      const staffEmail = `sec-role-${stamp}@test.local`;

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: staffEmail, password, name: 'Staff' })
        .expect(201);

      await prisma.user.update({
        where: { email: staffEmail },
        data: { role: 'ORDER_MANAGER' },
      });

      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: staffEmail, password })
        .expect(200);

      await request(app.getHttpServer())
        .get('/auth/admin-check')
        .set('authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
    });
  });
});
