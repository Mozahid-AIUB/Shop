import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Catalog — অ্যাডমিন CRUD, public তালিকা, আর স্টকের নিয়ম।
 * আসল DB লাগে।
 */
describe('Catalog', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const staffEmail = `cat-staff-${stamp}@test.local`;
  const customerEmail = `cat-cust-${stamp}@test.local`;
  const password = 'secret123';

  let staffToken = '';
  let customerToken = '';
  let categoryId = '';

  /** প্রতি রানে আলাদা slug, যাতে আগের রানের row-তে ধাক্কা না লাগে। */
  const categorySlug = `electronics-${stamp}`;
  const productSlug = `phone-${stamp}`;

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

    await prisma.user.update({
      where: { email: staffEmail },
      data: { role: 'ORDER_MANAGER' },
    });

    const staffLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: staffEmail, password })
      .expect(200);
    staffToken = staffLogin.body.accessToken;

    const customerRegister = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: customerEmail, password, name: 'Customer' })
      .expect(201);
    customerToken = customerRegister.body.accessToken;
  });

  afterAll(async () => {
    // Product cascade-এ variant/image/attribute মুছবে
    await prisma.product.deleteMany({ where: { slug: { startsWith: `phone-${stamp}` } } });
    await prisma.category.deleteMany({ where: { slug: { startsWith: `electronics-${stamp}` } } });
    await prisma.user.deleteMany({ where: { email: { in: [staffEmail, customerEmail] } } });
    await app.close();
  });

  describe('categories', () => {
    it('lets staff create a top-level category', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/categories')
        .set('authorization', `Bearer ${staffToken}`)
        .send({ name: 'Electronics', slug: categorySlug })
        .expect(201);

      expect(response.body).toMatchObject({ name: 'Electronics', slug: categorySlug });
      categoryId = response.body.id;
    });

    it('keeps customers out of category creation', async () => {
      await request(app.getHttpServer())
        .post('/admin/categories')
        .set('authorization', `Bearer ${customerToken}`)
        .send({ name: 'Sneaky', slug: `sneaky-${stamp}` })
        .expect(403);
    });

    it('rejects a duplicate slug', async () => {
      await request(app.getHttpServer())
        .post('/admin/categories')
        .set('authorization', `Bearer ${staffToken}`)
        .send({ name: 'Another', slug: categorySlug })
        .expect(409);
    });

    it('allows a second level but refuses a third', async () => {
      const child = await request(app.getHttpServer())
        .post('/admin/categories')
        .set('authorization', `Bearer ${staffToken}`)
        .send({ name: 'Phones', slug: `${categorySlug}-phones`, parentId: categoryId })
        .expect(201);

      // দুই স্তরই সীমা — তৃতীয় স্তর মেনু আর breadcrumb দুটোই জটিল করে
      await request(app.getHttpServer())
        .post('/admin/categories')
        .set('authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Smartphones',
          slug: `${categorySlug}-smart`,
          parentId: child.body.id,
        })
        .expect(400);
    });
  });

  describe('products', () => {
    let productId = '';
    let variantId = '';

    it('creates a product with variants, attributes and images in one call', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/products')
        .set('authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Test Phone',
          slug: productSlug,
          description: 'A phone for testing',
          categoryId,
          isPublished: true,
          variants: [
            {
              sku: `SKU-${stamp}-128`,
              pricePaisa: 4500000,
              comparePricePaisa: 5000000,
              stock: 10,
              options: [{ name: 'Storage', value: '128GB' }],
            },
            {
              sku: `SKU-${stamp}-256`,
              pricePaisa: 5500000,
              stock: 5,
              options: [{ name: 'Storage', value: '256GB' }],
            },
          ],
          attributes: [{ name: 'RAM', value: '8GB' }],
          images: [{ url: 'https://example.com/phone.jpg', sortOrder: 0 }],
        })
        .expect(201);

      expect(response.body.variants).toHaveLength(2);
      expect(response.body.attributes).toHaveLength(1);

      productId = response.body.id;
      variantId = response.body.variants[0].id;
    });

    it('rejects a float price — money must be integer paisa', async () => {
      await request(app.getHttpServer())
        .post('/admin/products')
        .set('authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Float Price',
          slug: `${productSlug}-float`,
          categoryId,
          variants: [{ sku: `SKU-${stamp}-F`, pricePaisa: 199.99, stock: 1 }],
        })
        .expect(400);
    });

    it('rejects a compare price below the selling price', async () => {
      await request(app.getHttpServer())
        .post('/admin/products')
        .set('authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Fake Discount',
          slug: `${productSlug}-fake`,
          categoryId,
          variants: [
            {
              sku: `SKU-${stamp}-FD`,
              pricePaisa: 100000,
              comparePricePaisa: 50000,
              stock: 1,
            },
          ],
        })
        .expect(400);
    });

    it('requires at least one variant', async () => {
      await request(app.getHttpServer())
        .post('/admin/products')
        .set('authorization', `Bearer ${staffToken}`)
        .send({
          name: 'No Variants',
          slug: `${productSlug}-novar`,
          categoryId,
          variants: [],
        })
        .expect(400);
    });

    it('shows a published product on the public API', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products/${productSlug}`)
        .expect(200);

      expect(response.body).toMatchObject({ slug: productSlug, name: 'Test Phone' });
      expect(response.body.variants).toHaveLength(2);
    });

    it('hides an unpublished product from the public API', async () => {
      const hiddenSlug = `${productSlug}-draft`;

      await request(app.getHttpServer())
        .post('/admin/products')
        .set('authorization', `Bearer ${staffToken}`)
        .send({
          name: 'Draft Product',
          slug: hiddenSlug,
          categoryId,
          isPublished: false,
          variants: [{ sku: `SKU-${stamp}-D`, pricePaisa: 10000, stock: 1 }],
        })
        .expect(201);

      // খসড়া জিনিস slug জানা থাকলেও দেখা যাবে না
      await request(app.getHttpServer()).get(`/products/${hiddenSlug}`).expect(404);

      const list = await request(app.getHttpServer()).get('/products').expect(200);
      const slugs = list.body.items.map((item: { slug: string }) => item.slug);
      expect(slugs).not.toContain(hiddenSlug);
    });

    it('filters by category and paginates with a cursor', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products?categorySlug=${categorySlug}&limit=1`)
        .expect(200);

      expect(response.body.items).toHaveLength(1);
      expect(response.body).toHaveProperty('nextCursor');
    });

    describe('stock', () => {
      it('adds stock with a positive delta', async () => {
        const response = await request(app.getHttpServer())
          .patch(`/admin/variants/${variantId}/stock`)
          .set('authorization', `Bearer ${staffToken}`)
          .send({ delta: 5, reason: 'restock' })
          .expect(200);

        expect(response.body.stock).toBe(15);
      });

      it('removes stock with a negative delta', async () => {
        const response = await request(app.getHttpServer())
          .patch(`/admin/variants/${variantId}/stock`)
          .set('authorization', `Bearer ${staffToken}`)
          .send({ delta: -3, reason: 'damaged' })
          .expect(200);

        expect(response.body.stock).toBe(12);
      });

      /**
       * সবচেয়ে বড় ঝুঁকি — স্টকের চেয়ে বেশি বিক্রি।
       * ঋণাত্মক স্টক মানে যে পণ্য নেই তার অর্ডার নেওয়া হয়েছে।
       */
      it('refuses to take stock below zero', async () => {
        await request(app.getHttpServer())
          .patch(`/admin/variants/${variantId}/stock`)
          .set('authorization', `Bearer ${staffToken}`)
          .send({ delta: -1000 })
          .expect(409);

        const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
        expect(variant!.stock).toBe(12);
      });

      /**
       * দুজন একসাথে স্টক কমালে দুটোই গুনতে হবে।
       * read-then-write করলে একটা হারিয়ে যায় (lost update)।
       */
      it('counts every concurrent decrement', async () => {
        const start = await prisma.productVariant.findUnique({ where: { id: variantId } });

        const results = await Promise.all(
          Array.from({ length: 6 }, () =>
            request(app.getHttpServer())
              .patch(`/admin/variants/${variantId}/stock`)
              .set('authorization', `Bearer ${staffToken}`)
              .send({ delta: -2 }),
          ),
        );

        const succeeded = results.filter((r) => r.status === 200).length;

        const end = await prisma.productVariant.findUnique({ where: { id: variantId } });
        expect(end!.stock).toBe(start!.stock - succeeded * 2);
        expect(end!.stock).toBeGreaterThanOrEqual(0);
      });

      it('keeps customers out of stock changes', async () => {
        await request(app.getHttpServer())
          .patch(`/admin/variants/${variantId}/stock`)
          .set('authorization', `Bearer ${customerToken}`)
          .send({ delta: 100 })
          .expect(403);
      });
    });

    it('lets a super admin delete, but not an order manager', async () => {
      await request(app.getHttpServer())
        .delete(`/admin/products/${productId}`)
        .set('authorization', `Bearer ${staffToken}`)
        .expect(403);
    });
  });
});
