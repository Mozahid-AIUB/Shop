import { Module } from '@nestjs/common';
import { ShippingAdminController, ShippingQuoteController } from './shipping.controller';
import { ShippingService } from './shipping.service';

/**
 * ডেলিভারি চার্জ। checkout আর (পরে) কার্টের quote endpoint — দুটোই
 * একই service ব্যবহার করবে, তাই `exports`।
 */
@Module({
  controllers: [ShippingQuoteController, ShippingAdminController],
  providers: [ShippingService],
  exports: [ShippingService],
})
export class ShippingModule {}
