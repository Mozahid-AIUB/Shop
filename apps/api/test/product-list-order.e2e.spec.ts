import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * `GET /products` — sorting and filtering, which used to be wrong.
 *
 * **Why a separate spec:** `sort=price_asc` ordered by the *number of
 * variants* a product had, not by its price. Every product here has a
 * different variant count on purpose, arranged so that sorting by count
 * gives a different answer than sorting by price. Without that, a test
 * could pass while the bug was still there.
 *
 * Needs the real database.
 */
describe('Product list ordering', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const staffEmail = `order-staff-${stamp}@test.local`;
  const password = 'secret123';

  let staffToken = '';
  let categoryId = '';

  const categorySlug = `tools-${stamp}`;
  const slugs = {
    cheap: `cheap-tool-${stamp}`,
    mid: `mid-tool-${stamp}`,
    dear: `dear-tool-${stamp}`,
  };

  const variant = (sku: string, pricePaisa: number) => ({
    sku,
    pricePaisa,
    stock: 5,
    isActive: true,
    options: [],
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: staffEmail, password, name: 'Staff' })
      .expect(201);

    await prisma.user.update({ where: { email: staffEmail }, data: { role: 'ORDER_MANAGER' } });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password })
      .expect(200);
    staffToken = login.body.accessToken;

    const category = await request(app.getHttpServer())
      .post('/admin/categories')
      .set('authorization', `Bearer ${staffToken}`)
      .send({ name: 'Hand Tools', slug: categorySlug })
      .expect(201);
    categoryId = category.body.id;

    /**
     * দাম আর variant সংখ্যা **উল্টো দিকে** সাজানো:
     * সস্তাটার variant সবচেয়ে বেশি, দামিটার সবচেয়ে কম। তাই সংখ্যা ধরে
     * সাজালে ফল ঠিক উল্টো আসবে আর টেস্ট ধরা পড়বে।
     */
    const products = [
      {
        name: 'Cheap Tool',
        slug: slugs.cheap,
        variants: [
          variant(`${slugs.cheap}-a`, 10000),
          variant(`${slugs.cheap}-b`, 12000),
          variant(`${slugs.cheap}-c`, 14000),
        ],
      },
      {
        name: 'Mid Tool',
        slug: slugs.mid,
        variants: [variant(`${slugs.mid}-a`, 50000), variant(`${slugs.mid}-b`, 52000)],
      },
      {
        name: 'Dear Tool',
        slug: slugs.dear,
        variants: [variant(`${slugs.dear}-a`, 90000)],
      },
    ];

    for (const product of products) {
      await request(app.getHttpServer())
        .post('/admin/products')
        .set('authorization', `Bearer ${staffToken}`)
        .send({
          categoryId,
          isPublished: true,
          description: 'A tool',
          attributes: [],
          images: [],
          ...product,
        })
        .expect(201);
    }
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { slug: { in: Object.values(slugs) } } });
    await prisma.category.deleteMany({ where: { slug: categorySlug } });
    await prisma.user.deleteMany({ where: { email: staffEmail } });
    await app.close();
  });

  /** শুধু এই টেস্টের পণ্যগুলো — DB-তে অন্য পণ্যও থাকতে পারে। */
  const ourNames = async (query: string): Promise<string[]> => {
    const response = await request(app.getHttpServer())
      .get(`/products?categorySlug=${categorySlug}&${query}`)
      .expect(200);

    return (response.body.items as { name: string }[]).map((item) => item.name);
  };

  describe('sorting by price', () => {
    it('puts the cheapest first, by price and not by variant count', async () => {
      expect(await ourNames('sort=price_asc')).toEqual(['Cheap Tool', 'Mid Tool', 'Dear Tool']);
    });

    it('puts the dearest first when asked', async () => {
      expect(await ourNames('sort=price_desc')).toEqual(['Dear Tool', 'Mid Tool', 'Cheap Tool']);
    });

    it('compares the price a buyer actually sees — the lowest variant', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products?categorySlug=${categorySlug}&sort=price_asc`)
        .expect(200);

      const prices = (response.body.items as { fromPricePaisa: number | null }[]).map(
        (item) => item.fromPricePaisa,
      );

      expect(prices).toEqual([10000, 50000, 90000]);
    });

    it('still pages correctly while sorted by price', async () => {
      const first = await request(app.getHttpServer())
        .get(`/products?categorySlug=${categorySlug}&sort=price_asc&limit=2`)
        .expect(200);

      expect((first.body.items as { name: string }[]).map((i) => i.name)).toEqual([
        'Cheap Tool',
        'Mid Tool',
      ]);
      expect(first.body.nextCursor).not.toBeNull();

      const second = await request(app.getHttpServer())
        .get(
          `/products?categorySlug=${categorySlug}&sort=price_asc&limit=2&cursor=${first.body.nextCursor as string}`,
        )
        .expect(200);

      expect((second.body.items as { name: string }[]).map((i) => i.name)).toEqual(['Dear Tool']);
      expect(second.body.nextCursor).toBeNull();
    });
  });

  describe('searching the list', () => {
    it('finds a product by its category name, not only its own fields', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products?search=${encodeURIComponent('Hand Tools')}`)
        .expect(200);

      const names = (response.body.items as { name: string }[]).map((item) => item.name);

      expect(names).toContain('Cheap Tool');
    });

    it('treats a wildcard character as text', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products?categorySlug=${categorySlug}&search=%25`)
        .expect(200);

      expect(response.body.items).toEqual([]);
    });
  });
});
