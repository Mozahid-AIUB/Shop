import { Module } from '@nestjs/common';
import { AddressService } from './address.service';
import { CartService } from './cart.service';
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
    OrderLifecycleService,
  ],
  // Phase 07-এর production task আর Phase 09-এর রিপোর্ট এগুলো ব্যবহার করবে
  exports: [OrdersService, OrderNumberService, OrderLifecycleService],
})
export class OrdersModule {}
