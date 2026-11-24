import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { ShippingModule } from '../shipping/shipping.module';
import { AddressService } from './address.service';
import { CartService } from './cart.service';
import { FraudService } from './fraud.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderNumberService } from './order-number.service';
import {
  OrderAdminController,
  OrderCancelController,
  OrderTrackingController,
} from './order-admin.controller';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  // ActivityLogService-এর জন্য — status বদল ও বাতিল লগে যায়
  imports: [AdminModule, ShippingModule],
  controllers: [
    OrdersController,
    OrderAdminController,
    OrderCancelController,
    OrderTrackingController,
  ],
  providers: [
    CartService,
    AddressService,
    OrdersService,
    OrderNumberService,
    FraudService,
    OrderLifecycleService,
  ],
  // Phase 07-এর production task আর Phase 09-এর রিপোর্ট এগুলো ব্যবহার করবে
  exports: [OrdersService, OrderNumberService, OrderLifecycleService],
})
export class OrdersModule {}
