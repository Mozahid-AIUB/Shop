import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// .env রুটে আছে (monorepo-র সব workspace একই env শেয়ার করে)
loadEnv({ path: '../../.env', quiet: true });

/**
 * Prisma 7-এ connection URL আর `schema.prisma`-তে থাকে না —
 * migrate/introspect CLI এখান থেকে নেয়, runtime client নেয় driver adapter থেকে
 * (দেখো: src/prisma/prisma.service.ts)
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
