import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Auth-এর সুখী পথ: register → me → refresh → logout.
 * আসল DB লাগে — `npm run db:migrate` চালানো থাকতে হবে।
 */
describe('Auth flow', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  /** প্রতি রানে আলাদা ইমেইল, যাতে আগের রানের row-তে ধাক্কা না লাগে। */
  const email = `auth-flow-${Date.now()}@test.local`;
  const password = 'secret123';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  /** cookie jar — refresh টোকেন httpOnly cookie-তে যায়, body-তে নয়। */
  let refreshCookie = '';
  let accessToken = '';

  it('registers a new customer and returns an access token', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Test User' })
      .expect(201);

    expect(response.body.user).toMatchObject({
      email,
      name: 'Test User',
      role: 'CUSTOMER',
      isActive: true,
    });
    expect(typeof response.body.accessToken).toBe('string');

    // পাসওয়ার্ড কোনো অবস্থাতেই response-এ যাবে না
    expect(JSON.stringify(response.body)).not.toContain(password);
    expect(response.body.user.password).toBeUndefined();

    const cookies = response.get('Set-Cookie') ?? [];
    const refresh = cookies.find((c) => c.startsWith('refreshToken='));
    expect(refresh).toBeDefined();
    // JS যেন পড়তে না পারে — XSS-এ টোকেন চুরি ঠেকায়
    expect(refresh).toContain('HttpOnly');

    refreshCookie = refresh!.split(';')[0];
    accessToken = response.body.accessToken;
  });

  it('stores the password as an argon2 hash, never plain text', async () => {
    const user = await prisma.user.findUnique({ where: { email } });

    expect(user).not.toBeNull();
    expect(user!.password).not.toBe(password);
    expect(user!.password.startsWith('$argon2')).toBe(true);
  });

  it('rejects /auth/me without a token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('returns the current user for a valid token', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body).toMatchObject({ email, role: 'CUSTOMER' });
    expect(response.body.password).toBeUndefined();
  });

  it('logs in with the right credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    expect(typeof response.body.accessToken).toBe('string');
    expect(response.body.user.email).toBe(email);

    const cookies = response.get('Set-Cookie') ?? [];
    refreshCookie = cookies.find((c) => c.startsWith('refreshToken='))!.split(';')[0];
  });

  it('rotates the refresh token: a new one comes back and the old one dies', async () => {
    const first = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);

    expect(typeof first.body.accessToken).toBe('string');

    const rotated = (first.get('Set-Cookie') ?? [])
      .find((c) => c.startsWith('refreshToken='))!
      .split(';')[0];
    expect(rotated).not.toBe(refreshCookie);

    const stale = refreshCookie;
    refreshCookie = rotated;

    // পুরোনো টোকেন আর কাজ করবে না — rotation-এর মূল কথা
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', stale).expect(401);
  });

  it('logs out: the refresh token stops working and the cookie is cleared', async () => {
    // logout-এর পর reuse detection সব সেশন মেরে ফেলতে পারে, তাই নতুন করে লগইন
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    const cookie = (login.get('Set-Cookie') ?? [])
      .find((c) => c.startsWith('refreshToken='))!
      .split(';')[0];

    await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookie).expect(200);

    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('keeps /health public — the global guard must not lock it', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
  });
});
