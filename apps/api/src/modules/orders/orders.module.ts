import { Module } from '@nestjs/common';
import { AddressService } from './address.service';
import { CartService } from './cart.service';
import { OrderNumberService } from './order-number.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController],
  providers: [CartService, AddressService, OrdersService, OrderNumberService],
  // Phase 07-এর অ্যাডমিন প্যানেল আর Phase 05-এর পেমেন্ট এগুলো ব্যবহার করবে
  exports: [OrdersService, OrderNumberService],
})
export class OrdersModule {}
