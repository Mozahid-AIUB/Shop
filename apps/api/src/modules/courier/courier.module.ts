import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { CourierAccountService } from './courier-account.service';
import {
  CourierAdminController,
  CourierWebhookController,
  ShipmentAdminController,
} from './courier.controller';
import { CourierRegistry } from './courier.registry';
import { CourierService } from './courier.service';
import { ManualProvider } from './providers/manual.provider';
import { SteadfastProvider } from './providers/steadfast.provider';

/**
 * কুরিয়ার (Phase 10)।
 *
 * `OrdersModule` import করা হয় `OrderLifecycleService`-এর জন্য —
 * পার্সেল পাঠানো হলে অর্ডারও `SHIPPED` হয়ে যায়। নিজে status
 * বদলালে নিয়ম দুই জায়গায় আলাদা হয়ে যেত।
 *
 * **নতুন কুরিয়ার যোগ করতে:** provider লিখে এখানে `providers`-এ
 * আর `CourierRegistry`-র constructor-এ যোগ করো। বাকি কোনো ফাইল
 * ছুঁতে হবে না।
 */
@Module({
  imports: [OrdersModule],
  controllers: [CourierAdminController, ShipmentAdminController, CourierWebhookController],
  providers: [
    ManualProvider,
    SteadfastProvider,
    CourierRegistry,
    CourierAccountService,
    CourierService,
  ],
  exports: [CourierService, CourierAccountService],
})
export class CourierModule {}
