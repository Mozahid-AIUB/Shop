import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 7-এ connection URL schema.prisma-তে থাকে না — runtime-এ driver adapter দিয়ে দিতে হয়।
 * CLI-র (migrate/studio) URL আসে prisma.config.ts থেকে।
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * হালকা connectivity probe — health check এটা ব্যবহার করে।
   * থ্রো করে; caller সিদ্ধান্ত নেবে কী রেসপন্স দেবে।
   */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
