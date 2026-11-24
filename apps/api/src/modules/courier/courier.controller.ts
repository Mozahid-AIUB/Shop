import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import type { Shipment } from '@prisma/client';
import {
  COURIERS,
  courierAccountInputSchema,
  courierAccountUpdateSchema,
  dispatchInputSchema,
  shipmentStatusUpdateSchema,
  type AccessTokenPayload,
  type Courier,
  type CourierAccountInput,
  type CourierAccountUpdate,
  type CourierAccountView,
  type DispatchInput,
  type ShipmentStatusUpdate,
} from '@shop/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CourierAccountService } from './courier-account.service';
import { CourierRegistry } from './courier.registry';
import { CourierService } from './courier.service';

/**
 * কুরিয়ার সেটআপ — **শুধু মালিক**।
 *
 * `SUPER_ADMIN` only, ইচ্ছাকৃতভাবে। কুরিয়ারের key দিয়ে ব্যবসার
 * অ্যাকাউন্টে পার্সেল পাঠানো যায় আর COD-র টাকার হিসাব বদলানো যায় —
 * এটা স্টাফের কাজ নয়।
 */
@Roles('SUPER_ADMIN')
@Controller('admin/couriers')
export class CourierAdminController {
  constructor(
    private readonly accounts: CourierAccountService,
    private readonly registry: CourierRegistry,
  ) {}

  @Get()
  list(): Promise<CourierAccountView[]> {
    return this.accounts.list();
  }

  /**
   * কোন কুরিয়ারগুলোর সংযোগ সত্যিই তৈরি।
   *
   * প্যানেল এটা দেখে বোঝে কোনটা বাছা যাবে — নইলে অ্যাডমিন key
   * বসিয়ে চালু করে অর্ডার পাঠাতে গিয়ে জানত যে adapter নেই।
   */
  @Get('supported')
  supported(): { kind: Courier; supported: boolean }[] {
    return COURIERS.map((kind) => ({ kind, supported: this.registry.isSupported(kind) }));
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(courierAccountInputSchema)) body: CourierAccountInput,
  ): Promise<CourierAccountView> {
    return this.accounts.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(courierAccountUpdateSchema)) body: CourierAccountUpdate,
  ): Promise<CourierAccountView> {
    return this.accounts.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.accounts.remove(id);
  }
}

/**
 * অর্ডার কুরিয়ারে পাঠানো ও পার্সেল দেখা।
 *
 * `ORDER_MANAGER`-ও পারে: পার্সেল পাঠানো দৈনিক কাজ, আর শুধু
 * মালিকের হাতে রাখলে সে ছুটিতে গেলে অর্ডার আটকে থাকত। key
 * দেখা বা বদলানো এখানে নেই — সেটা উপরের controller-এ।
 */
@Roles('SUPER_ADMIN', 'ORDER_MANAGER')
@Controller('admin')
export class ShipmentAdminController {
  constructor(private readonly courier: CourierService) {}

  @Post('orders/:orderNumber/dispatch')
  dispatch(
    @CurrentUser() user: AccessTokenPayload,
    @Param('orderNumber') orderNumber: string,
    @Body(new ZodValidationPipe(dispatchInputSchema)) body: DispatchInput,
  ): Promise<Shipment> {
    return this.courier.dispatch(orderNumber, body, user.sub);
  }

  /**
   * পার্সেলের অবস্থা হাতে বদলানো।
   *
   * `MANUAL` কুরিয়ারে এটাই একমাত্র পথ — webhook পাঠানোর কেউ নেই।
   * API-ওয়ালা কুরিয়ারেও দরকার হয়: webhook হারিয়ে গেলে বা কুরিয়ার
   * ফোনে জানালে অ্যাডমিনকে হাতে ঠিক করতে দিতে হবে।
   */
  @Patch('shipments/:id/status')
  updateStatus(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(shipmentStatusUpdateSchema)) body: ShipmentStatusUpdate,
  ): Promise<Shipment> {
    return this.courier.updateStatus(id, body, user.sub);
  }
}

/**
 * কুরিয়ারের webhook।
 *
 * **`@Public()`, কারণ কুরিয়ার আমাদের JWT জানে না** — যাচাই হয়
 * webhook secret দিয়ে, যা অ্যাডমিন প্যানেলে বসানো।
 *
 * **secret ছাড়া কিছুই নেওয়া হয় না।** নিলে যে কেউ "DELIVERED"
 * পাঠিয়ে অর্ডার ডেলিভারড দেখাত, আর COD-র টাকা না পেয়েই হিসাব
 * মিলে যেত। ভুয়া রিটার্নও পাঠানো যেত, যা ক্রেতার ঝুঁকির স্কোর
 * নষ্ট করত।
 */
@Public()
@Controller('courier-webhook')
export class CourierWebhookController {
  constructor(
    private readonly accounts: CourierAccountService,
    private readonly registry: CourierRegistry,
    private readonly courier: CourierService,
  ) {}

  /**
   * ২০০ ফেরে প্রায় সবসময়, ইচ্ছাকৃতভাবে।
   *
   * কুরিয়ার ত্রুটি পেলে একই webhook বারবার retry করে আর তাদের
   * queue আটকে যায়। "আমরা এটা নিয়ে কিছু করব না" আর "আমাদের
   * সার্ভার ভেঙেছে" — কুরিয়ারের দিক থেকে দুটোই একই, তাই
   * অপ্রাসঙ্গিক webhook-ও ২০০ পায়।
   *
   * ব্যতিক্রম: ভুল signature (৪০১) আর অজানা কুরিয়ার (৪০৪) —
   * দুটোই সেটআপের ভুল, আর retry করে ঠিক হবে না।
   */
  @Post(':courier')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('courier') courierParam: string,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<{ received: boolean }> {
    const kind = COURIERS.find((name) => name.toLowerCase() === courierParam.toLowerCase());

    if (kind === undefined) {
      throw new NotFoundException('এই নামের কুরিয়ার নেই');
    }

    const found = await this.accounts.findForWebhook(kind);

    if (found === null) {
      throw new NotFoundException('এই কুরিয়ার সেটআপ করা নেই');
    }

    /**
     * secret না বসানো থাকলে **আগেই থামা হয়** — adapter-এ পাঠানোই
     * হয় না। adapter-এও যাচাই আছে, কিন্তু এখানে থামালে বার্তাটা
     * অ্যাডমিনের জন্য স্পষ্ট হয়: secret বসাতে হবে।
     */
    if (found.webhookSecret === null) {
      throw new UnauthorizedException(
        'এই কুরিয়ারের webhook secret বসানো নেই — প্যানেল থেকে বসান',
      );
    }

    const update = this.registry.get(kind).parseWebhook(body, headers, found.webhookSecret);

    if (update === null) {
      /**
       * signature ভুল, নাকি ঘটনাটা আমাদের কাজে লাগে না — adapter
       * দুটোকেই `null` বলে। আলাদা করা হয় না ইচ্ছাকৃতভাবে: কোনটা
       * কী সেটা বললে ভুয়া webhook পাঠিয়ে signature অনুমান করার
       * চেষ্টা সহজ হয়ে যেত।
       */
      return { received: false };
    }

    await this.courier.applyWebhook(kind, update);

    return { received: true };
  }
}
