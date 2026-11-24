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
  UnauthorizedException,
} from '@nestjs/common';
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
import { OptionalAuth } from '../auth/decorators/optional-auth.decorator';
import { AddressService, type AddressView } from './address.service';
import { GuestToken, Owner, type CartOwner } from './cart-owner';
import { CartService, type CartView } from './cart.service';
import { OrdersService, type OrderDetail, type OrderSummary } from './orders.service';

/**
 * কার্ট, ঠিকানা আর অর্ডার — সবই **নিজের**।
 *
 * **দুই ধরনের route:**
 *
 * `@OptionalAuth()`-ওয়ালা (কার্ট আর চেকআউট) গেস্টও ব্যবহার করতে
 * পারে — তাকে চেনা হয় `x-guest-token` header দিয়ে। এগুলোতে
 * `@Owner()` আসে, যেটা হয় user নয় guest, আর প্রতিটা query সেই
 * owner-এ বাঁধা।
 *
 * বাকিগুলো (ঠিকানার তালিকা, অর্ডারের তালিকা, অর্ডার দেখা) লগইন
 * ছাড়া চলে না — গেস্টের সংরক্ষিত ঠিকানা নেই, আর তার অর্ডারের
 * তালিকা দেওয়ার মতো কোনো পরিচয়ও নেই। সে `/track`-এ অর্ডার
 * নম্বর + ফোন দিয়ে দেখে (Phase 06)।
 *
 * `@Roles` কোথাও নেই: যেকোনো ক্রেতা নিজের জিনিসে কাজ করে, আর
 * প্রতিটা service owner শর্তে কাজ করায় স্টাফ হলেও অন্যের কার্ট
 * ছোঁয়া যায় না।
 */
@Controller()
export class OrdersController {
  constructor(
    private readonly cart: CartService,
    private readonly addresses: AddressService,
    private readonly orders: OrdersService,
  ) {}

  // ---------- Guest session ----------

  /**
   * গেস্টকে টোকেন দেওয়া — কার্টে কিছু রাখার **আগে** ক্লায়েন্ট একবার ডাকে।
   *
   * লগইন ছাড়াই চলে — এই call-টাই পরিচয় তৈরি করে, তাই আগে থেকে
   * চেনার কিছু নেই। টোকেন সার্ভার বানায়; ক্লায়েন্টকে বানাতে দিলে
   * কেউ `guest-1`, `guest-2` পাঠিয়ে অন্যের কার্ট খুলে ফেলত।
   *
   * লগইন করা ক্রেতা ডাকলেও ক্ষতি নেই — টোকেনটা তার কোনো কাজে
   * লাগবে না, কারণ তার নিজের কার্টই সবসময় অগ্রাধিকার পায়।
   */
  @Post('cart/guest')
  @OptionalAuth()
  createGuestSession(): { guestToken: string } {
    return this.cart.issueGuestToken();
  }

  /**
   * লগইনের পর গেস্ট কার্ট নিজের কার্টে মিশিয়ে নেওয়া।
   *
   * **ফ্রন্টএন্ড লগইন/রেজিস্টারের পরপর এটা ডাকবে।** না ডাকলে
   * ক্রেতা কার্ট ভরে লগইন করার পর কার্ট খালি দেখত — আর সেটা ঠিক
   * সেই মুহূর্তে, যখন সে কিনতে সবচেয়ে কাছে।
   *
   * `@OptionalAuth()` নেই: লগইন **বাধ্যতামূলক**, কারণ কোথায়
   * মেশাব সেটা জানতে হবে। গেস্ট টোকেন না থাকলে ত্রুটি নয় —
   * নিজের কার্টই ফেরে, কারণ সরাসরি লগইন পাতায় আসা ক্রেতার
   * টোকেন থাকার কথা নয়।
   *
   * ২০০, ২০১ নয় — নতুন কিছু তৈরি হচ্ছে না, বিদ্যমান কার্ট বদলাচ্ছে।
   */
  @Post('cart/merge')
  @HttpCode(HttpStatus.OK)
  mergeCart(
    @CurrentUser() user: AccessTokenPayload,
    @GuestToken() guestToken: string | null,
  ): Promise<CartView> {
    return this.cart.merge(user.sub, guestToken);
  }

  // ---------- Cart ----------

  @Get('cart')
  @OptionalAuth()
  viewCart(@Owner() owner: CartOwner | null): Promise<CartView> {
    return this.cart.view(owner);
  }

  @Post('cart/items')
  @OptionalAuth()
  addCartItem(
    @Owner() owner: CartOwner | null,
    @Body(new ZodValidationPipe(addCartItemSchema)) body: AddCartItemInput,
  ): Promise<CartView> {
    return this.cart.addItem(this.requireOwner(owner), body);
  }

  @Patch('cart/items/:id')
  @OptionalAuth()
  updateCartItem(
    @Owner() owner: CartOwner | null,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCartItemSchema)) body: UpdateCartItemInput,
  ): Promise<CartView> {
    return this.cart.updateItem(this.requireOwner(owner), id, body);
  }

  @Delete('cart/items/:id')
  @OptionalAuth()
  removeCartItem(
    @Owner() owner: CartOwner | null,
    @Param('id') id: string,
  ): Promise<CartView> {
    return this.cart.removeItem(this.requireOwner(owner), id);
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
  @OptionalAuth()
  checkout(
    @Owner() owner: CartOwner | null,
    @Body(new ZodValidationPipe(checkoutInputSchema)) body: CheckoutInput,
  ): Promise<OrderDetail> {
    return this.orders.checkout(this.requireOwner(owner), body);
  }

  /**
   * নিজের অর্ডারের তালিকা — **লগইন লাগবে**।
   *
   * গেস্টের এখানে কিছু দেখানোর নেই: তার পরিচয় নেই, তাই "তার"
   * অর্ডার বলতে কিছু বোঝায় না। টোকেন ধরে দেখালে এক গেস্ট অন্য
   * গেস্টের অর্ডার দেখে ফেলতে পারত। সে `/track` ব্যবহার করে।
   */
  @Get('orders')
  listOrders(@CurrentUser() user: AccessTokenPayload): Promise<OrderSummary[]> {
    return this.orders.list(user.sub);
  }

  /**
   * আইডি নয়, **orderNumber** দিয়ে — ইউজার যেটা জানে আর ফোনে বলে
   * সেটাই URL-এ থাকা উচিত।
   *
   * গেস্টের জন্য নয়: নম্বরে তারিখ আর সিরিয়াল থাকায় অনুমান করা সহজ,
   * তাই শুধু নম্বর জানলেই অর্ডার খোলা যাবে না। গেস্ট `/track`-এ
   * নম্বর **আর** ফোন দুটোই দিয়ে দেখে।
   */
  @Get('orders/:orderNumber')
  findOrder(
    @CurrentUser() user: AccessTokenPayload,
    @Param('orderNumber') orderNumber: string,
  ): Promise<OrderDetail> {
    return this.orders.findOne(user.sub, orderNumber);
  }

  /**
   * মালিক ছাড়া কার্টে কিছু করা যায় না।
   *
   * `GET /cart` খালি কার্ট দেখায় (প্রথমবার আসা ক্রেতার টোকেন নেই,
   * তাকে ত্রুটি দেখানো অর্থহীন), কিন্তু **লেখার** সময় কার কার্টে
   * লিখছি সেটা জানতেই হবে। না জেনে লিখলে কার্টটা কারো নয় এমন
   * অবস্থায় পড়ে থাকত আর ক্রেতা সেটা আর খুঁজে পেত না।
   */
  private requireOwner(owner: CartOwner | null): CartOwner {
    if (owner === null) {
      throw new UnauthorizedException(
        'কার্ট ব্যবহার করতে লগইন করুন বা গেস্ট সেশন শুরু করুন',
      );
    }

    return owner;
  }
}
