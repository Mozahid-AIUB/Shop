import { Module } from '@nestjs/common';
import { CouponAdminController, CouponController } from './coupon.controller';
import { CouponService } from './coupon.service';

/**
 * কুপন ও ক্যাম্পেইন।
 *
 * `exports` দরকার কারণ checkout (`OrdersModule`) কুপনটা **অর্ডারের
 * transaction-এর ভেতর থেকে** প্রয়োগ করে — গোনা আর লেখা একই
 * transaction-এ না হলে দুটো চেকআউট একই শেষ কুপন পেয়ে যেত।
 */
@Module({
  controllers: [CouponController, CouponAdminController],
  providers: [CouponService],
  exports: [CouponService],
})
export class CouponModule {}
