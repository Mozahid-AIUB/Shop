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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
