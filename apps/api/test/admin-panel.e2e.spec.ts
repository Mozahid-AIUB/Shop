import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * প্রোডাকশনের কাজ, অডিট লগ আর ইনভয়েস। আসল DB লাগে।
 */
describe('Admin panel', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const stamp = Date.now();
  const adminEmail = `ap-admin-${stamp}@test.local`;
  const managerEmail = `ap-mgr-${stamp}@test.local`;
  const designerEmail = `ap-design-${stamp}@test.local`;
  const otherDesignerEmail = `ap-design2-${stamp}@test.local`;
  const buyerEmail = `ap-buyer-${stamp}@test.local`;
  const password = 'secret123';

  let adminToken = '';
  let managerToken = '';
  let designerToken = '';
  let otherDesignerToken = '';
  let buyerToken = '';

  let designerId = '';

  const categorySlug = `ap-cat-${stamp}`;
  const productSlug = `ap-item-${stamp}`;
  const UNIT_PRICE_PAISA = 75_000;

  let orderNumber = '';
  let variantId = '';

  const authed = (token: string) => ({ authorization: `Bearer ${token}` });

  const makeUser = async (email: string, role?: string): Promise<string> => {
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name: 'Admin Panel Test' })
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

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    adminToken = await makeUser(adminEmail, 'SUPER_ADMIN');
    managerToken = await makeUser(managerEmail, 'ORDER_MANAGER');
    designerToken = await makeUser(designerEmail, 'DESIGNER');
    otherDesignerToken = await makeUser(otherDesignerEmail, 'DESIGNER');
    buyerToken = await makeUser(buyerEmail);

    const designer = await prisma.user.findUniqueOrThrow({
      where: { email: designerEmail },
      select: { id: true },
    });
    designerId = designer.id;

    const category = await request(app.getHttpServer())
      .post('/admin/categories')
      .set(authed(adminToken))
      .send({ name: 'Admin Panel Cat', slug: categorySlug })
      .expect(201);

    const product = await request(app.getHttpServer())
      .post('/admin/products')
      .set(authed(adminToken))
      .send({
        name: 'Admin Panel Item',
        slug: productSlug,
        categoryId: category.body.id,
        isPublished: true,
        variants: [{ sku: `SKU-AP-${stamp}`, pricePaisa: UNIT_PRICE_PAISA, stock: 30 }],
      })
      .expect(201);

    variantId = product.body.variants[0].id;

    await request(app.getHttpServer())
      .post('/cart/items')
      .set(authed(buyerToken))
      .send({ variantId, quantity: 2 })
      .expect(201);

    const order = await request(app.getHttpServer())
      .post('/orders')
      .set(authed(buyerToken))
      .send({
        address: {
          fullName: 'Panel Buyer',
          phone: '01712345678',
          line1: 'House 7, Road 2',
          city: 'Bashundhara',
          district: 'Dhaka',
        },
      })
      .expect(201);

    orderNumber = order.body.orderNumber;
  });

  afterAll(async () => {
    const emails = [
      adminEmail,
      managerEmail,
      designerEmail,
      otherDesignerEmail,
      buyerEmail,
    ];
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);

    await prisma.activityLog.deleteMany({ where: { actorId: { in: userIds } } });
    // ProductionTask cascade-এ অর্ডারের সাথেই মুছবে
    await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.product.deleteMany({ where: { slug: productSlug } });
    await prisma.category.deleteMany({ where: { slug: categorySlug } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  });

  describe('creating tasks', () => {
    it('lets a manager open a task on an order', async () => {
      const response = await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/tasks`)
        .set(authed(managerToken))
        .send({ kind: 'PRINT', note: 'সামনে বড় লোগো' })
        .expect(201);

      expect(response.body).toMatchObject({
        kind: 'PRINT',
        status: 'PENDING',
        note: 'সামনে বড় লোগো',
      });
      // কেউ না নিলে খোলা পড়ে থাকবে
      expect(response.body.assignedTo).toBeNull();
    });

    it('can assign the task as it is created', async () => {
      const response = await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/tasks`)
        .set(authed(adminToken))
        .send({ kind: 'DESIGN', assignedToId: designerId })
        .expect(201);

      expect(response.body.assignedTo).toMatchObject({ email: designerEmail });
    });

    /** ডিজাইনার কাজ করে, কাজ বিলি করে না। */
    it('refuses a designer', async () => {
      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/tasks`)
        .set(authed(designerToken))
        .send({ kind: 'PRINT' })
        .expect(403);
    });

    it('refuses a customer', async () => {
      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/tasks`)
        .set(authed(buyerToken))
        .send({ kind: 'PRINT' })
        .expect(403);
    });

    it('rejects a kind that is not in the enum', async () => {
      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/tasks`)
        .set(authed(adminToken))
        .send({ kind: 'TELEPATHY' })
        .expect(400);
    });

    it('answers 404 for an order that does not exist', async () => {
      await request(app.getHttpServer())
        .post('/admin/orders/ORD-2020-0101-001/tasks')
        .set(authed(adminToken))
        .send({ kind: 'PRINT' })
        .expect(404);
    });
  });

  describe('working on tasks', () => {
    let myTaskId = '';

    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/tasks`)
        .set(authed(adminToken))
        .send({ kind: 'QC', assignedToId: designerId })
        .expect(201);

      myTaskId = created.body.id;
    });

    it('lets the assignee move their own task along', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/admin/tasks/${myTaskId}`)
        .set(authed(designerToken))
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      expect(response.body.status).toBe('IN_PROGRESS');
    });

    /**
     * অন্য ডিজাইনার এই কাজের দায়িত্বে নেই — তার বদলানোর অধিকার নেই।
     * না হলে একজনের কাজ আরেকজন "শেষ" লিখে দিতে পারত।
     */
    it('stops another designer from touching a task that is not theirs', async () => {
      await request(app.getHttpServer())
        .patch(`/admin/tasks/${myTaskId}`)
        .set(authed(otherDesignerToken))
        .send({ status: 'DONE' })
        .expect(403);
    });

    /** ম্যানেজারকে যেকোনো কাজ ঠিক করতে হয় — কর্মী ছুটিতে গেলে। */
    it('lets a manager update any task', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/admin/tasks/${myTaskId}`)
        .set(authed(managerToken))
        .send({ note: 'ম্যানেজার দেখেছে' })
        .expect(200);

      expect(response.body.note).toBe('ম্যানেজার দেখেছে');
    });

    it('needs at least one field to change', async () => {
      await request(app.getHttpServer())
        .patch(`/admin/tasks/${myTaskId}`)
        .set(authed(managerToken))
        .send({})
        .expect(400);
    });

    /** শেষ হওয়া কাজ আবার খোলা যাবে না — নতুন কাজ খুলতে হবে। */
    it('refuses to reopen a finished task', async () => {
      await request(app.getHttpServer())
        .patch(`/admin/tasks/${myTaskId}`)
        .set(authed(managerToken))
        .send({ status: 'DONE' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/admin/tasks/${myTaskId}`)
        .set(authed(managerToken))
        .send({ status: 'IN_PROGRESS' })
        .expect(409);
    });
  });

  describe('assigning', () => {
    let taskId = '';

    beforeAll(async () => {
      const created = await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/tasks`)
        .set(authed(adminToken))
        .send({ kind: 'PACKING' })
        .expect(201);

      taskId = created.body.id;
    });

    it('hands a task to a staff member', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/admin/tasks/${taskId}/assign`)
        .set(authed(managerToken))
        .send({ assignedToId: designerId })
        .expect(200);

      expect(response.body.assignedTo).toMatchObject({ email: designerEmail });
    });

    it('can take the assignment back off', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/admin/tasks/${taskId}/assign`)
        .set(authed(managerToken))
        .send({ assignedToId: null })
        .expect(200);

      expect(response.body.assignedTo).toBeNull();
    });

    /** কাস্টমারকে কাজ দেওয়া যাবে না — সে কর্মী নয়। */
    it('refuses to assign work to a customer', async () => {
      const buyer = await prisma.user.findUniqueOrThrow({
        where: { email: buyerEmail },
        select: { id: true },
      });

      await request(app.getHttpServer())
        .patch(`/admin/tasks/${taskId}/assign`)
        .set(authed(managerToken))
        .send({ assignedToId: buyer.id })
        .expect(400);
    });

    it('refuses a designer', async () => {
      await request(app.getHttpServer())
        .patch(`/admin/tasks/${taskId}/assign`)
        .set(authed(designerToken))
        .send({ assignedToId: designerId })
        .expect(403);
    });
  });

  describe('the task board', () => {
    it('pages the list', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/tasks?perPage=3')
        .set(authed(managerToken))
        .expect(200);

      expect(response.body.tasks.length).toBeLessThanOrEqual(3);
      expect(response.body).toMatchObject({ page: 1, perPage: 3 });
    });

    it('filters by status and kind', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/tasks?status=PENDING&kind=PRINT')
        .set(authed(managerToken))
        .expect(200);

      for (const task of response.body.tasks) {
        expect(task.status).toBe('PENDING');
        expect(task.kind).toBe('PRINT');
      }
    });

    /** "আমার কাজ" — কর্মীর সবচেয়ে বেশি দরকারি দৃশ্য। */
    it('shows only my work when asked', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/tasks?mine=true')
        .set(authed(designerToken))
        .expect(200);

      for (const task of response.body.tasks) {
        expect(task.assignedTo.email).toBe(designerEmail);
      }
    });

    it('finds the tasks of one order', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/tasks?orderNumber=${orderNumber}`)
        .set(authed(managerToken))
        .expect(200);

      expect(response.body.tasks.length).toBeGreaterThan(0);
    });

    it('caps the page size', async () => {
      await request(app.getHttpServer())
        .get('/admin/tasks?perPage=100000')
        .set(authed(managerToken))
        .expect(400);
    });

    it('refuses a customer', async () => {
      await request(app.getHttpServer()).get('/admin/tasks').set(authed(buyerToken)).expect(403);
    });
  });

  describe('the activity log', () => {
    /**
     * লগ লেখা হয় **পাশে**, মূল কাজের সাথে নয় — লগ লিখতে ব্যর্থ হলে
     * অর্ডারের status বদল বা পেমেন্ট আটকে যাওয়া উচিত নয়।
     */
    it('records a status change', async () => {
      await request(app.getHttpServer())
        .patch(`/admin/orders/${orderNumber}/status`)
        .set(authed(managerToken))
        .send({ toStatus: 'DESIGN_CONFIRMED' })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/admin/activity?action=order.status_changed')
        .set(authed(adminToken))
        .expect(200);

      const entry = response.body.entries.find(
        (row: { summary: string | null }) =>
          row.summary !== null && row.summary.includes('DESIGN_CONFIRMED'),
      );

      expect(entry).toBeDefined();
      expect(entry.actor).toMatchObject({ email: managerEmail });
      expect(entry.entityType).toBe('Order');
    });

    it('records a payment', async () => {
      await request(app.getHttpServer())
        .post(`/admin/orders/${orderNumber}/payments`)
        .set(authed(adminToken))
        .send({ amountPaisa: 20_000, method: 'CASH' })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/admin/activity?action=payment.recorded')
        .set(authed(adminToken))
        .expect(200);

      expect(response.body.entries.length).toBeGreaterThan(0);
      expect(response.body.entries[0].entityType).toBe('Payment');
    });

    it('records a task being created', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/activity?action=task.created')
        .set(authed(adminToken))
        .expect(200);

      expect(response.body.entries.length).toBeGreaterThan(0);
    });

    /**
     * লগে কে কী করেছে থাকে — এটা কর্মীদের উপর নজরদারির তথ্য,
     * তাই শুধু SUPER_ADMIN দেখবে।
     */
    it('is hidden from a manager and a designer', async () => {
      await request(app.getHttpServer())
        .get('/admin/activity')
        .set(authed(managerToken))
        .expect(403);

      await request(app.getHttpServer())
        .get('/admin/activity')
        .set(authed(designerToken))
        .expect(403);
    });

    it('is hidden from a customer', async () => {
      await request(app.getHttpServer())
        .get('/admin/activity')
        .set(authed(buyerToken))
        .expect(403);
    });

    it('has no way to delete an entry', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/activity?perPage=1')
        .set(authed(adminToken))
        .expect(200);

      const id = response.body.entries[0].id;

      // অডিট ট্রেইল মোছা গেলে সেটা আর অডিট নয়
      await request(app.getHttpServer())
        .delete(`/admin/activity/${id}`)
        .set(authed(adminToken))
        .expect(404);
    });
  });

  describe('invoice data', () => {
    it('returns the order, its items and what is still owed', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/orders/${orderNumber}/invoice`)
        .set(authed(adminToken))
        .expect(200);

      expect(response.body).toMatchObject({ orderNumber });
      expect(response.body.items.length).toBeGreaterThan(0);
      expect(response.body.totalPaisa).toBe(UNIT_PRICE_PAISA * 2);
      // আগের টেস্টে ২০০ টাকা নেওয়া হয়েছে
      expect(response.body.paidPaisa).toBe(20_000);
      expect(response.body.duePaisa).toBe(UNIT_PRICE_PAISA * 2 - 20_000);
      expect(response.body.shipFullName).toBe('Panel Buyer');
    });

    it('refuses a customer', async () => {
      await request(app.getHttpServer())
        .get(`/admin/orders/${orderNumber}/invoice`)
        .set(authed(buyerToken))
        .expect(403);
    });
  });
});
