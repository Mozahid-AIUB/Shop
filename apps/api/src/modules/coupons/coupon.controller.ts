import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Coupon } from '@prisma/client';
import {
  couponInputSchema,
  couponUpdateSchema,
  type CouponInput,
  type CouponUpdate,
  type CouponValidateResult,
} from '@shop/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { THROTTLE_COUPON } from '../../common/throttle.config';
import { Owner, type CartOwner } from '../orders/cart-owner';
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CouponService } from './coupon.service';

/**
 * কার্টে কোড বসিয়ে যাচাই।
 *
 * **গেস্টও পারে।** না পারলে গেস্ট কার্টের পাতায় কুপন বসিয়ে ছাড়
 * দেখতেই পেত না, আর চেকআউটে গিয়ে চমকে যেত। rate limit IP ধরে
 * চলে, তাই পরিচয় ছাড়াও কোড অনুমান করা আটকায়।
 */
const validateBodySchema = z.object({
  code: z.string().trim().min(1, 'কুপন কোড দিন').max(32),
  /**
   * কার্টের অঙ্ক।
   *
   * **এটা শুধু দেখানোর হিসাবের জন্য।** আসল ছাড় চেকআউটে সার্ভারের
   * নিজের গোনা subtotal দিয়ে আবার হিসাব হয় — তাই এখানে ক্রেতা বড়
   * অঙ্ক পাঠিয়ে বেশি ছাড় "আদায়" করতে পারে না, শুধু নিজের কার্টের
   * পাতায় ভুল সংখ্যা দেখবে।
   */
  subtotalPaisa: z.number().int().nonnegative(),
  shippingPaisa: z.number().int().nonnegative().default(0),
});

type ValidateBody = z.infer<typeof validateBodySchema>;

@Controller('coupons')
export class CouponController {
  constructor(private readonly coupons: CouponService) {}

  /**
   * **rate limit আছে, ইচ্ছাকৃতভাবে।** নইলে কেউ স্ক্রিপ্ট চালিয়ে
   * হাজার হাজার কোড অনুমান করে কাজের কুপন খুঁজে বের করত — আর
   * প্রতিটা চেষ্টা DB-তে দুটো count query চালাত।
   */
  @Throttle({ [THROTTLE_COUPON]: { limit: 10, ttl: 60_000 } })
  @Post('validate')
  @OptionalAuth()
  @HttpCode(HttpStatus.OK)
  validate(
    @Owner() owner: CartOwner | null,
    @Body(new ZodValidationPipe(validateBodySchema)) body: ValidateBody,
  ): Promise<CouponValidateResult> {
    /**
     * গেস্ট হলে `null` — তখন প্রতি-ক্রেতা সীমাওয়ালা কুপন
     * `LOGIN_REQUIRED` বলে ফিরিয়ে দেয়, আর UI ক্রেতাকে লগইন করতে
     * বলতে পারে। চেকআউটেও একই নিয়ম, তাই কার্টে যা দেখবে
     * চেকআউটেও তাই পাবে।
     */
    const userId = owner !== null && owner.kind === 'user' ? owner.userId : null;

    return this.coupons.validate(body.code, userId, {
      subtotalPaisa: body.subtotalPaisa,
      shippingPaisa: body.shippingPaisa,
    });
  }
}

/**
 * কুপন বানানো ও বদলানো — **সব অ্যাডমিন প্যানেল থেকে**।
 *
 * `SUPER_ADMIN` only: কুপন সরাসরি টাকা ছাড়ের সিদ্ধান্ত। ভুল করে
 * `PERCENT 100` বসালে সব পণ্য ফ্রি হয়ে যেত।
 */
@Roles('SUPER_ADMIN')
@Controller('admin/coupons')
export class CouponAdminController {
  constructor(private readonly coupons: CouponService) {}

  @Get()
  list(): Promise<Coupon[]> {
    return this.coupons.listAll();
  }

  @Get(':id/usage')
  usage(@Param('id') id: string): ReturnType<CouponService['usageReport']> {
    return this.coupons.usageReport(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(couponInputSchema)) body: CouponInput,
  ): Promise<Coupon> {
    return this.coupons.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(couponUpdateSchema)) body: CouponUpdate,
  ): Promise<Coupon> {
    return this.coupons.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.coupons.remove(id);
  }
}
