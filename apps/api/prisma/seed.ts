import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

loadEnv({ path: '../../.env', quiet: true });

/**
 * প্রথম Super Admin। রেজিস্ট্রেশন API দিয়ে admin বানানো যায় না
 * (সেখানে সবাই CUSTOMER), তাই প্রথম অ্যাকাউন্টটা এখান থেকেই আসতে হয়।
 *
 * পাসওয়ার্ড হার্ডকোড করা হয়নি ইচ্ছাকৃতভাবে — কেউ seed চালিয়ে
 * জানা পাসওয়ার্ড দিয়ে প্রোডাকশনে ঢুকে পড়তে পারত।
 */
async function main(): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? 'Super Admin';

  if (!email || !password) {
    throw new Error(
      'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env — refusing to seed with a default password',
    );
  }

  if (password.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const admin = await prisma.user.upsert({
      where: { email: email.toLowerCase() },
      // বারবার চালালেও পাসওয়ার্ড রিসেট হবে না — শুধু role নিশ্চিত করা হয়
      update: { role: 'SUPER_ADMIN', isActive: true },
      create: {
        email: email.toLowerCase(),
        name,
        password: await argon2.hash(password, {
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
        role: 'SUPER_ADMIN',
      },
      select: { id: true, email: true, role: true },
    });

    console.log(`Super admin ready: ${admin.email} (${admin.role})`);

    await seedCatalog(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * নমুনা ক্যাটালগ — তিন রকমের পণ্য দিয়ে দেখানো হয় একই schema-তে
 * ফোন, জামা আর বই — তিনটাই বসে, কারণ যা আলাদা তা attribute-এ যায়।
 */
async function seedCatalog(prisma: PrismaClient): Promise<void> {
  const electronics = await prisma.category.upsert({
    where: { slug: 'electronics' },
    update: {},
    create: { name: 'Electronics', slug: 'electronics', sortOrder: 1 },
  });

  const phones = await prisma.category.upsert({
    where: { slug: 'phones' },
    update: {},
    create: { name: 'Phones', slug: 'phones', parentId: electronics.id, sortOrder: 1 },
  });

  const clothing = await prisma.category.upsert({
    where: { slug: 'clothing' },
    update: {},
    create: { name: 'Clothing', slug: 'clothing', sortOrder: 2 },
  });

  const books = await prisma.category.upsert({
    where: { slug: 'books' },
    update: {},
    create: { name: 'Books', slug: 'books', sortOrder: 3 },
  });

  const samples = [
    {
      name: 'Galaxy A55 5G',
      slug: 'galaxy-a55-5g',
      description: 'Mid-range phone with a 120Hz display.',
      categoryId: phones.id,
      attributes: [
        { name: 'RAM', value: '8GB' },
        { name: 'Battery', value: '5000mAh' },
      ],
      variants: [
        { sku: 'A55-128', pricePaisa: 4299000, comparePricePaisa: 4599000, stock: 12, options: [{ name: 'Storage', value: '128GB' }] },
        { sku: 'A55-256', pricePaisa: 4799000, stock: 7, options: [{ name: 'Storage', value: '256GB' }] },
      ],
    },
    {
      name: 'Cotton Polo Shirt',
      slug: 'cotton-polo-shirt',
      description: 'Breathable cotton polo for everyday wear.',
      categoryId: clothing.id,
      attributes: [{ name: 'Fabric', value: '100% Cotton' }],
      variants: [
        { sku: 'POLO-M-BLK', pricePaisa: 89000, stock: 25, options: [{ name: 'Size', value: 'M' }, { name: 'Color', value: 'Black' }] },
        { sku: 'POLO-L-BLK', pricePaisa: 89000, stock: 18, options: [{ name: 'Size', value: 'L' }, { name: 'Color', value: 'Black' }] },
        { sku: 'POLO-L-NVY', pricePaisa: 95000, comparePricePaisa: 110000, stock: 0, options: [{ name: 'Size', value: 'L' }, { name: 'Color', value: 'Navy' }] },
      ],
    },
    {
      name: 'Atomic Habits',
      slug: 'atomic-habits',
      description: 'A practical guide to building better habits.',
      categoryId: books.id,
      attributes: [
        { name: 'Author', value: 'James Clear' },
        { name: 'Pages', value: '320' },
      ],
      variants: [
        { sku: 'BOOK-AH-PB', pricePaisa: 45000, stock: 40, options: [{ name: 'Format', value: 'Paperback' }] },
      ],
    },
  ];

  for (const sample of samples) {
    const existing = await prisma.product.findUnique({ where: { slug: sample.slug } });

    if (existing) {
      continue;
    }

    await prisma.product.create({
      data: {
        name: sample.name,
        slug: sample.slug,
        description: sample.description,
        categoryId: sample.categoryId,
        isPublished: true,
        attributes: { create: sample.attributes },
        variants: {
          create: sample.variants.map((variant) => ({
            sku: variant.sku,
            pricePaisa: variant.pricePaisa,
            comparePricePaisa: variant.comparePricePaisa ?? null,
            stock: variant.stock,
            options: { create: variant.options },
          })),
        },
      },
    });
  }

  const count = await prisma.product.count({ where: { isPublished: true } });
  console.log(`Catalog ready: ${count} published products`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
