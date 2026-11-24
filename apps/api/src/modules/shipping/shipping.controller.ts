import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  shippingQuoteQuerySchema,
  shippingZoneInputSchema,
  shippingZoneUpdateSchema,
  type ShippingQuote,
  type ShippingQuoteQuery,
  type ShippingZoneInput,
  type ShippingZoneUpdate,
} from '@shop/shared';
import type { ShippingZone } from '@prisma/client';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ShippingService } from './shipping.service';

/**
 * ক্রেতার জন্য — কার্টে "ডেলিভারি চার্জ ৬০ টাকা" দেখাতে।
 *
 * লগইন ছাড়াই খোলা, কারণ ক্রেতা অ্যাকাউন্ট খোলার আগেই চার্জ জানতে
 * চায়। ফাঁস হওয়ার কিছু নেই — চার্জ তো দোকানের ঘোষিত তথ্য।
 */
@Public()
@Controller('shipping')
export class ShippingQuoteController {
  constructor(private readonly shipping: ShippingService) {}

  @Get('quote')
  quote(
    @Query(new ZodValidationPipe(shippingQuoteQuerySchema)) query: ShippingQuoteQuery,
  ): Promise<ShippingQuote> {
    return this.shipping.quote(query.district, query.subtotalPaisa);
  }
}

/**
 * এলাকা ও চার্জ ঠিক করা — **সব অ্যাডমিন প্যানেল থেকে**, কোডে কিছু নয়।
 *
 * `SUPER_ADMIN` only: চার্জ বদলানো সরাসরি আয়ে প্রভাব ফেলে, আর ভুল
 * করে ফ্রি করে দিলে প্রতি অর্ডারে লোকসান — অথচ অর্ডার সফলই দেখাবে।
 */
@Roles('SUPER_ADMIN')
@Controller('admin/shipping-zones')
export class ShippingAdminController {
  constructor(private readonly shipping: ShippingService) {}

  @Get()
  list(): Promise<ShippingZone[]> {
    return this.shipping.listAll();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(shippingZoneInputSchema)) body: ShippingZoneInput,
  ): Promise<ShippingZone> {
    return this.shipping.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(shippingZoneUpdateSchema)) body: ShippingZoneUpdate,
  ): Promise<ShippingZone> {
    return this.shipping.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.shipping.remove(id);
  }
}
