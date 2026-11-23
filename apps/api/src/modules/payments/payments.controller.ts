import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  recordPaymentSchema,
  voidPaymentSchema,
  type AccessTokenPayload,
  type RecordPaymentInput,
  type VoidPaymentInput,
} from '@shop/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaymentsService, type PaymentsView } from './payments.service';

/**
 * কাস্টমারের দিক — **শুধু নিজের** অর্ডারের টাকার হিসাব, পড়া মাত্র।
 * লেখার কোনো পথ নেই: কাস্টমার নিজে "টাকা দিয়েছি" লিখতে পারলে
 * বিনা পেমেন্টে পণ্য চলে যেত।
 */
@Controller('orders')
export class CustomerPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':orderNumber/payments')
  view(
    @CurrentUser() user: AccessTokenPayload,
    @Param('orderNumber') orderNumber: string,
  ): Promise<PaymentsView> {
    return this.payments.viewForCustomer(user.sub, orderNumber);
  }
}

/**
 * স্টাফের দিক — পেমেন্ট লেখা ও বাতিল।
 *
 * `DESIGNER` বাদ: তার কাজ ছাপা, টাকার হিসাবে নয়। class-level
 * `@Roles` সব route-এ বসে, তাই নতুন endpoint যোগ করলেও ডিফল্টে বন্ধ।
 */
@Roles('SUPER_ADMIN', 'ACCOUNTANT', 'ORDER_MANAGER')
@Controller('admin')
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('orders/:orderNumber/payments')
  view(@Param('orderNumber') orderNumber: string): Promise<PaymentsView> {
    return this.payments.viewForStaff(orderNumber);
  }

  @Post('orders/:orderNumber/payments')
  record(
    @CurrentUser() user: AccessTokenPayload,
    @Param('orderNumber') orderNumber: string,
    @Body(new ZodValidationPipe(recordPaymentSchema)) body: RecordPaymentInput,
  ): Promise<PaymentsView> {
    return this.payments.record(orderNumber, body, user.sub);
  }

  /**
   * 200, 201 নয় — নতুন কিছু তৈরি হচ্ছে না, বিদ্যমান row-এর
   * অবস্থা বদলাচ্ছে।
   */
  @Post('payments/:id/void')
  @HttpCode(HttpStatus.OK)
  voidPayment(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(voidPaymentSchema)) body: VoidPaymentInput,
  ): Promise<PaymentsView> {
    return this.payments.void(id, body, user.sub);
  }
}
