import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { AdminModule } from './modules/admin/admin.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env'],
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    CatalogModule,
    OrdersModule,
    PaymentsModule,
    AdminModule,
  ],
  providers: [
    /**
     * ক্রম গুরুত্বপূর্ণ — JwtAuthGuard আগে চলে request.user বসায়,
     * তারপর RolesGuard সেটা দেখে সিদ্ধান্ত নেয়।
     *
     * ডিফল্টে সব route বন্ধ; খুলতে `@Public()` লিখতে হয়।
     * উল্টোটা হলে একটা decorator ভুলে গেলেই route ফাঁস হয়ে যেত।
     */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
