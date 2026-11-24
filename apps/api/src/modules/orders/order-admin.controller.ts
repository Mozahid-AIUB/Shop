import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  cancelOrderSchema,
  changeOrderStatusSchema,
  orderListQuerySchema,
  trackOrderSchema,
  type AccessTokenPayload,
  type CancelOrderInput,
  type ChangeOrderStatusInput,
  type OrderListQuery,
  type TrackOrderInput,
} from '@shop/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { THROTTLE_TRACK } from '../../common/throttle.config';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  OrderLifecycleService,
  type OrderBoardPage,
  type OrderFullDetail,
  type PublicTrackingView,
} from './order-lifecycle.service';

/**
 * অ্যাডমিন অর্ডার বোর্ড ও status বদল।
 *
 * `DESIGNER` এখানে ঢুকতে পারে কারণ তাকে নিজের ধাপ এগোতে হয়
 * (DESIGN_CONFIRMED → IN_PRODUCTION → PRINTED)। কোন transition
 * সে করতে পারবে সেটা service-এ আলাদা করে যাচাই হয় — role থাকা
 * মানেই সব ধাপ বদলানোর অনুমতি নয়।
 */
@Roles('SUPER_ADMIN', 'ORDER_MANAGER', 'DESIGNER')
@Controller('admin/orders')
export class OrderAdminController {
  constructor(private readonly lifecycle: OrderLifecycleService) {}

  @Get()
  board(
    @Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQuery,
  ): Promise<OrderBoardPage> {
    return this.lifecycle.board(query);
  }

  @Get(':orderNumber')
  findOne(@Param('orderNumber') orderNumber: string): Promise<OrderFullDetail> {
    return this.lifecycle.findForStaff(orderNumber);
  }

  @Patch(':orderNumber/status')
  changeStatus(
    @CurrentUser() user: AccessTokenPayload,
    @Param('orderNumber') orderNumber: string,
    @Body(new ZodValidationPipe(changeOrderStatusSchema)) body: ChangeOrderStatusInput,
  ): Promise<OrderFullDetail> {
    return this.lifecycle.changeStatus(orderNumber, body, { id: user.sub, role: user.role });
  }
}

/** কাস্টমারের নিজের অর্ডার বাতিল। */
@Controller('orders')
export class OrderCancelController {
  constructor(private readonly lifecycle: OrderLifecycleService) {}

  /** 200 — নতুন কিছু তৈরি হচ্ছে না, বিদ্যমান অর্ডারের অবস্থা বদলাচ্ছে। */
  @Post(':orderNumber/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AccessTokenPayload,
    @Param('orderNumber') orderNumber: string,
    @Body(new ZodValidationPipe(cancelOrderSchema)) body: CancelOrderInput,
  ): Promise<OrderFullDetail> {
    return this.lifecycle.cancelByCustomer(user.sub, orderNumber, body);
  }
}

/**
 * লগইন ছাড়া অর্ডার ট্র্যাক — দোকানের সবচেয়ে বেশি ব্যবহৃত পাতা হবে।
 *
 * POST, GET নয়: ফোন নম্বর URL-এ গেলে সার্ভারের access log, ব্রাউজার
 * history আর referer header-এ জমা হতো।
 *
 * মিনিটে ১০ বার — এটাই পুরো অ্যাপের সবচেয়ে আঁটসাঁট সীমা, কারণ
 * এটাই একমাত্র খোলা endpoint যেখানে অনুমানযোগ্য আইডি দিয়ে
 * ব্যক্তিগত তথ্য বের করা সম্ভব। আসল কাস্টমার একবার বা দুবার
 * দেখে, ১০ বার নয়।
 */
@Public()
@Throttle({ [THROTTLE_TRACK]: {} })
@Controller('track')
export class OrderTrackingController {
  constructor(private readonly lifecycle: OrderLifecycleService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  track(
    @Body(new ZodValidationPipe(trackOrderSchema)) body: TrackOrderInput,
  ): Promise<PublicTrackingView> {
    return this.lifecycle.track(body);
  }
}
