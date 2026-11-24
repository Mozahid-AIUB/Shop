import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Product search — what a buyer types into the box.
 *
 * **Why these products:** the fixtures are deliberately chosen so that
 * every ranking rule can fail visibly. "Gaming Laptop" has the word in
 * its name, "Office Chair" only in its description, and "Laptop Sleeve"
 * has it in the name too but is a different thing — so a test can prove
 * a name match outranks a description match without the ordering being
 * an accident of insertion order.
 *
 * Bengali names are here because the shop sells in Bangladesh and the
 * buyer types Bengali. Postgres' full-text parser treats Bengali letters
 * as whitespace on a non-UTF-8 ctype, so `tsvector` indexes nothing at
 * all for these rows — that is why search is built on ILIKE instead, and
 * these tests are what stop anyone "optimising" it back to tsvector.
 *
 * Needs the real database.
 */
describe('Product search', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const staffEmail = `search-staff-${stamp}@test.local`;
  const password = 'secret123';

  let staffToken = '';
  let categoryId = '';

  const categorySlug = `gadgets-${stamp}`;
  const slugs = {
    laptop: `gaming-laptop-${stamp}`,
    chair: `office-chair-${stamp}`,
    sleeve: `laptop-sleeve-${stamp}`,
    bengali: `nil-shirt-${stamp}`,
    draft: `secret-laptop-${stamp}`,
  };

  const createProduct = async (body: Record<string, unknown>): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/admin/products')
      .set('authorization', `Bearer ${staffToken}`)
      .send({
        categoryId,
        isPublished: true,
        variants: [{ sku: `${body.slug as string}-v1`, pricePaisa: 500000, stock: 5, isActive: true, options: [] }],
        attributes: [],
        images: [],
        ...body,
      })
      .expect(201);

    return response.body.id;
  };

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
      .send({ name: 'Gadgets', slug: categorySlug })
      .expect(201);
    categoryId = category.body.id;

    await createProduct({
      name: 'Gaming Laptop',
      slug: slugs.laptop,
      description: 'A fast machine for play',
    });

    await createProduct({
      name: 'Office Chair',
      slug: slugs.chair,
      description: 'Comfortable while you use your laptop all day',
    });

    await createProduct({
      name: 'Laptop Sleeve',
      slug: slugs.sleeve,
      description: 'Padded cover',
    });

    await createProduct({
      name: 'নীল শার্ট',
      slug: slugs.bengali,
      description: 'সুতির আরামদায়ক পোশাক',
    });

    // খসড়া — storefront-এ কখনো আসা চলবে না
    await createProduct({
      name: 'Unreleased Laptop',
      slug: slugs.draft,
      description: 'Not announced yet',
      isPublished: false,
    });
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { slug: { in: Object.values(slugs) } } });
    await prisma.category.deleteMany({ where: { slug: categorySlug } });
    await prisma.user.deleteMany({ where: { email: staffEmail } });
    await app.close();
  });

  const search = async (q: string, extra = ''): Promise<request.Response> =>
    request(app.getHttpServer())
      .get(`/products/search?q=${encodeURIComponent(q)}${extra}`)
      .expect(200);

  const namesFrom = (response: request.Response): string[] =>
    (response.body.items as { name: string }[]).map((item) => item.name);

  describe('finding things', () => {
    it('finds a product by a word in its name', async () => {
      const names = namesFrom(await search('Gaming'));

      expect(names).toContain('Gaming Laptop');
    });

    it('finds a product by a word only in its description', async () => {
      // "Office Chair"-এর নামে laptop নেই, বিবরণে আছে
      const names = namesFrom(await search('laptop'));

      expect(names).toContain('Office Chair');
    });

    it('finds a product by its category name', async () => {
      const names = namesFrom(await search('Gadgets'));

      expect(names).toContain('Gaming Laptop');
    });

    it('ignores case', async () => {
      const names = namesFrom(await search('GAMING LAPTOP'));

      expect(names).toContain('Gaming Laptop');
    });

    it('matches a partial word, because buyers stop typing early', async () => {
      const names = namesFrom(await search('lapt'));

      expect(names).toContain('Gaming Laptop');
    });
  });

  describe('order of results', () => {
    it('puts a name match above a description-only match', async () => {
      const names = namesFrom(await search('laptop'));

      const sleeve = names.indexOf('Laptop Sleeve');
      const chair = names.indexOf('Office Chair');

      expect(sleeve).toBeGreaterThanOrEqual(0);
      expect(chair).toBeGreaterThanOrEqual(0);
      // নামে মিললে সেটাই আগে — নইলে ক্রেতা ভুল জিনিস দেখে ফিরে যায়
      expect(sleeve).toBeLessThan(chair);
    });

    it('puts a name that starts with the word above one that merely contains it', async () => {
      const names = namesFrom(await search('laptop'));

      // "Laptop Sleeve" শুরুতেই, "Gaming Laptop"-এ শব্দটা পরে
      expect(names.indexOf('Laptop Sleeve')).toBeLessThan(names.indexOf('Gaming Laptop'));
    });
  });

  describe('Bengali', () => {
    it('finds a product by its full Bengali name', async () => {
      const names = namesFrom(await search('নীল শার্ট'));

      expect(names).toContain('নীল শার্ট');
    });

    it('finds a product by one Bengali word', async () => {
      const names = namesFrom(await search('শার্ট'));

      expect(names).toContain('নীল শার্ট');
    });

    it('finds a product by part of a Bengali word', async () => {
      const names = namesFrom(await search('শার'));

      expect(names).toContain('নীল শার্ট');
    });

    it('finds a product by a Bengali word in its description', async () => {
      const names = namesFrom(await search('সুতির'));

      expect(names).toContain('নীল শার্ট');
    });
  });

  describe('what must never leak', () => {
    it('never returns a draft product', async () => {
      const names = namesFrom(await search('Laptop'));

      expect(names).not.toContain('Unreleased Laptop');
    });

    it('never returns a draft product even on an exact name match', async () => {
      const names = namesFrom(await search('Unreleased Laptop'));

      expect(names).not.toContain('Unreleased Laptop');
    });

    it('treats a SQL metacharacter as text, not as syntax', async () => {
      // `%` আর `_` ILIKE-এ wildcard; escape না করলে "%" লিখে সব পণ্য টেনে আনা যেত
      const response = await search('%');

      expect(response.body.items).toHaveLength(0);
    });

    it('treats an underscore as text too', async () => {
      const response = await search('_');

      expect(response.body.items).toHaveLength(0);
    });
  });

  describe('empty results', () => {
    it('returns an empty list rather than an error', async () => {
      const response = await search('zzzznotathing');

      expect(response.body.items).toEqual([]);
      expect(response.body.nextCursor).toBeNull();
    });

    it('suggests categories to browse when nothing matched', async () => {
      const response = await search('zzzznotathing');

      // "কিছু পাওয়া যায়নি" শেষ কথা নয় — কোথায় যাবে সেটা বলা দরকার
      expect(Array.isArray(response.body.suggestions)).toBe(true);
      expect(response.body.suggestions.length).toBeGreaterThan(0);
    });

    it('sends no suggestions when there were results', async () => {
      const response = await search('Gaming');

      expect(response.body.suggestions).toEqual([]);
    });
  });

  describe('input rules', () => {
    it('rejects a missing query', async () => {
      await request(app.getHttpServer()).get('/products/search').expect(400);
    });

    it('rejects a blank query', async () => {
      await request(app.getHttpServer()).get('/products/search?q=%20%20').expect(400);
    });

    it('rejects a limit beyond the cap', async () => {
      await request(app.getHttpServer()).get('/products/search?q=laptop&limit=500').expect(400);
    });
  });

  describe('paging', () => {
    it('hands back a cursor and does not repeat a row on the next page', async () => {
      const first = await search('laptop', '&limit=1');

      expect(first.body.items).toHaveLength(1);
      expect(first.body.nextCursor).not.toBeNull();

      const second = await search('laptop', `&limit=1&cursor=${first.body.nextCursor as string}`);
      const firstName = (first.body.items as { name: string }[])[0]?.name;
      const secondName = (second.body.items as { name: string }[])[0]?.name;

      expect(secondName).not.toBe(firstName);
    });

    it('ends paging with a null cursor', async () => {
      const response = await search('শার্ট', '&limit=24');

      expect(response.body.nextCursor).toBeNull();
    });
  });
});
