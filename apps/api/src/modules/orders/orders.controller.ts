import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  addCartItemSchema,
  checkoutInputSchema,
  createAddressSchema,
  updateAddressSchema,
  updateCartItemSchema,
  type AddCartItemInput,
  type CheckoutInput,
  type CreateAddressInput,
  type UpdateAddressInput,
  type UpdateCartItemInput,
  type AccessTokenPayload,
} from '@shop/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AddressService, type AddressView } from './address.service';
import { CartService, type CartView } from './cart.service';
import { OrdersService, type OrderDetail, type OrderSummary } from './orders.service';

/**
 * কার্ট, ঠিকানা আর অর্ডার — সবই **নিজের**।
 *
 * `@Roles` নেই: যেকোনো লগইন করা ইউজার নিজের কার্টে কাজ করতে পারে।
 * গ্লোবাল `JwtAuthGuard` আগেই anonymous আটকায়, আর প্রতিটা service
 * `userId` শর্তে কাজ করে — তাই স্টাফ হলেও অন্যের কার্ট ছোঁয়া যায় না।
 *
 * অ্যাডমিনের অর্ডার ব্যবস্থাপনা আলাদা controller-এ আসবে (Phase 07)।
 */
@Controller()
export class OrdersController {
  constructor(
    private readonly cart: CartService,
    private readonly addresses: AddressService,
    private readonly orders: OrdersService,
  ) {}

  // ---------- Cart ----------

  @Get('cart')
  viewCart(@CurrentUser() user: AccessTokenPayload): Promise<CartView> {
    return this.cart.view(user.sub);
  }

  @Post('cart/items')
  addCartItem(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(addCartItemSchema)) body: AddCartItemInput,
  ): Promise<CartView> {
    return this.cart.addItem(user.sub, body);
  }

  @Patch('cart/items/:id')
  updateCartItem(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCartItemSchema)) body: UpdateCartItemInput,
  ): Promise<CartView> {
    return this.cart.updateItem(user.sub, id, body);
  }

  @Delete('cart/items/:id')
  removeCartItem(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<CartView> {
    return this.cart.removeItem(user.sub, id);
  }

  // ---------- Addresses ----------

  @Get('addresses')
  listAddresses(@CurrentUser() user: AccessTokenPayload): Promise<AddressView[]> {
    return this.addresses.list(user.sub);
  }

  @Post('addresses')
  createAddress(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(createAddressSchema)) body: CreateAddressInput,
  ): Promise<AddressView> {
    return this.addresses.create(user.sub, body);
  }

  @Patch('addresses/:id')
  updateAddress(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAddressSchema)) body: UpdateAddressInput,
  ): Promise<AddressView> {
    return this.addresses.update(user.sub, id, body);
  }

  @Delete('addresses/:id')
  removeAddress(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<{ id: string }> {
    return this.addresses.remove(user.sub, id);
  }

  // ---------- Orders ----------

  @Post('orders')
  checkout(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(checkoutInputSchema)) body: CheckoutInput,
  ): Promise<OrderDetail> {
    return this.orders.checkout(user.sub, body);
  }

  @Get('orders')
  listOrders(@CurrentUser() user: AccessTokenPayload): Promise<OrderSummary[]> {
    return this.orders.list(user.sub);
  }

  /**
   * আইডি নয়, **orderNumber** দিয়ে — ইউজার যেটা জানে আর ফোনে বলে
   * সেটাই URL-এ থাকা উচিত।
   */
  @Get('orders/:orderNumber')
  findOrder(
    @CurrentUser() user: AccessTokenPayload,
    @Param('orderNumber') orderNumber: string,
  ): Promise<OrderDetail> {
    return this.orders.findOne(user.sub, orderNumber);
  }
}
