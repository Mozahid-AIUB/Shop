import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CheckoutInput } from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { cartWhere, type CartOwner } from './cart-owner';
import { formatOptions } from './cart.service';
import { FraudService } from './fraud.service';
import { OrderNumberService } from './order-number.service';
import { ShippingService } from '../shipping/shipping.service';
import { CouponService, type AppliedCoupon } from '../coupons/coupon.service';

const ORDER_LIST_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  subtotalPaisa: true,
  shippingPaisa: true,
  discountPaisa: true,
  shippingDiscountPaisa: true,
  totalPaisa: true,
  createdAt: true,
  items: { select: { id: true, productName: true, quantity: true }, take: 3 },
} satisfies Prisma.OrderSelect;

const ORDER_DETAIL_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  subtotalPaisa: true,
  shippingPaisa: true,
  discountPaisa: true,
  shippingDiscountPaisa: true,
  totalPaisa: true,
  shipFullName: true,
  shipPhone: true,
  shipLine1: true,
  shipLine2: true,
  shipCity: true,
  shipDistrict: true,
  shipPostcode: true,
  note: true,
  createdAt: true,
  items: {
    select: {
      id: true,
      variantId: true,
      productName: true,
      variantSku: true,
      optionsText: true,
      unitPricePaisa: true,
      quantity: true,
      lineTotalPaisa: true,
    },
  },
  history: {
    select: { id: true, fromStatus: true, toStatus: true, note: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.OrderSelect;

export type OrderSummary = Prisma.OrderGetPayload<{ select: typeof ORDER_LIST_SELECT }>;
export type OrderDetail = Prisma.OrderGetPayload<{ select: typeof ORDER_DETAIL_SELECT }>;

/** ঠিকানার স্ন্যাপশট — অর্ডারে কপি হয়ে বসে। */
interface ShippingSnapshot {
  addressId: string | null;
  shipFullName: string;
  shipPhone: string;
  shipLine1: string;
  shipLine2: string | null;
  shipCity: string;
  shipDistrict: string;
  shipPostcode: string | null;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderNumbers: OrderNumberService,
    private readonly fraud: FraudService,
    private readonly shippingRules: ShippingService,
    private readonly coupons: CouponService,
  ) {}

  /**
   * কুপনের ব্যবহার লিখে রাখা — অর্ডার তৈরি হওয়ার **পরে**, কারণ
   * `CouponRedemption.orderId` দরকার।
   *
   * `orderId @unique` থাকায় একই অর্ডারে দুবার লেখার চেষ্টা DB-তেই
   * আটকায় — এটাই race-এর শেষ রক্ষা।
   */
  private async recordCouponUse(
    tx: Prisma.TransactionClient,
    applied: AppliedCoupon | null,
    userId: string | null,
    orderId: string,
  ): Promise<void> {
    if (applied === null) {
      return;
    }

    await this.coupons.recordRedemption(tx, {
      couponId: applied.couponId,
      userId,
      orderId,
      discountPaisa: applied.discountPaisa,
      shippingDiscountPaisa: applied.shippingDiscountPaisa,
    });
  }

  /**
   * কুপন প্রয়োগ — **অর্ডারের transaction-এর ভেতর থেকেই**, ইচ্ছাকৃতভাবে।
   *
   * ব্যবহারের সংখ্যা গোনা আর লেখা একই transaction-এ না হলে দুটো
   * চেকআউট একসাথে এসে দুজনেই শেষ কুপনটা পেয়ে যেত। আর অর্ডার কোনো
   * কারণে ব্যর্থ হলে কুপনের ব্যবহারও rollback হয় — নইলে ক্রেতা কুপন
   * হারাত অথচ অর্ডার পেত না।
   *
   * ছাড়ের অঙ্ক **সার্ভারের নিজের গোনা** subtotal দিয়ে হিসাব হয়,
   * ক্লায়েন্টের পাঠানো কিছু দিয়ে নয়।
   */
  private applyCoupon(
    tx: Prisma.TransactionClient,
    code: string | undefined,
    amounts: { userId: string | null; subtotalPaisa: number; shippingPaisa: number },
  ): Promise<AppliedCoupon | null> {
    if (code === undefined) {
      return Promise.resolve(null);
    }

    return this.coupons.apply(tx, {
      code,
      userId: amounts.userId,
      subtotalPaisa: amounts.subtotalPaisa,
      shippingPaisa: amounts.shippingPaisa,
    });
  }

  /**
   * স্টক কমিয়ে রাখা — oversell-এর আসল রক্ষা।
   *
   * `stock: { gte: quantity }` শর্তে conditional update: না মিললে
   * `count` ০ আসে আর আমরা throw করি, ফলে পুরো transaction rollback
   * হয়। আগে পড়ে তারপর লেখা (read-then-write) করলে দুটো চেকআউট একই
   * স্টক পড়ে দুটোই পাস করে ফেলত — শেষ পিসটা দুজনকে বিক্রি হতো।
   */
  private async reserveStock(
    tx: Prisma.TransactionClient,
    lines: readonly { variantId: string; quantity: number; productName: string }[],
  ): Promise<void> {
    for (const line of lines) {
      const updated = await tx.productVariant.updateMany({
        where: { id: line.variantId, stock: { gte: line.quantity } },
        data: { stock: { decrement: line.quantity } },
      });

      if (updated.count === 0) {
        throw new ConflictException(`"${line.productName}" স্টকে নেই`);
      }
    }
  }

  /**
   * চেকআউট। একটা transaction-এ সব — নম্বর, স্টক, অর্ডার।
   * যেকোনো ধাপ ব্যর্থ হলে পুরোটা rollback, তাই স্টক কমে কিন্তু
   * অর্ডার তৈরি হয়নি এমন অবস্থা হয় না।
   *
   * দাম **কোথাও** ইনপুট থেকে আসে না — সব DB থেকে পড়া হয়।
   */
  async checkout(owner: CartOwner, input: CheckoutInput): Promise<OrderDetail> {
    /**
     * গেস্ট হলে `userId` `null` — অর্ডারটা কোনো অ্যাকাউন্টে বাঁধা
     * থাকবে না। এটা একবার এখানে বের করে নিচে সব জায়গায় ব্যবহার
     * করা হয়, যাতে প্রতিবার `owner.kind` দেখতে না হয়।
     */
    const userId = owner.kind === 'user' ? owner.userId : null;

    const cart = await this.prisma.cart.findUnique({
      where: cartWhere(owner),
      select: {
        id: true,
        items: {
          select: {
            variantId: true,
            quantity: true,
            variant: {
              select: {
                id: true,
                sku: true,
                pricePaisa: true,
                isActive: true,
                options: { select: { name: true, value: true } },
                product: { select: { name: true, isPublished: true } },
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('কার্ট খালি');
    }

    const unavailable = cart.items.find(
      (item) => !item.variant.isActive || !item.variant.product.isPublished,
    );

    if (unavailable) {
      throw new ConflictException(`"${unavailable.variant.product.name}" আর বিক্রি হচ্ছে না`);
    }

    const shipping = await this.resolveShipping(owner, input);

    // দাম সার্ভারে, DB-র `pricePaisa` ধরে — integer paisa, float নয়
    const lines = cart.items.map((item) => ({
      variantId: item.variantId,
      productName: item.variant.product.name,
      variantSku: item.variant.sku,
      optionsText: formatOptions(item.variant.options),
      unitPricePaisa: item.variant.pricePaisa,
      quantity: item.quantity,
      lineTotalPaisa: item.variant.pricePaisa * item.quantity,
    }));

    const subtotalPaisa = lines.reduce((sum, line) => sum + line.lineTotalPaisa, 0);

    /**
     * ডেলিভারি চার্জ — জেলা অনুযায়ী, DB-র নিয়ম থেকে (Phase 14)।
     *
     * **ছাড়ের আগের subtotal** দিয়ে গোনা হয়। কুপনের ছাড় বাদ দিয়ে
     * গুনলে ক্রেতা ছাড় নেওয়ার পর ফ্রি ডেলিভারির সীমার নিচে নেমে
     * যেত আর হঠাৎ চার্জ ফিরে আসত।
     *
     * চার্জটা অর্ডারে **কপি** হয়ে যায়, তাই পরে অ্যাডমিন চার্জ
     * বদলালেও পুরোনো অর্ডারের ইনভয়েস বদলাবে না।
     */
    const shippingQuote = await this.shippingRules.quote(shipping.shipDistrict, subtotalPaisa);
    const shippingPaisa = shippingQuote.chargePaisa;

    const created = await this.prisma.$transaction(
      async (tx) => {
        await this.reserveStock(tx, lines);

        const applied = await this.applyCoupon(tx, input.couponCode, {
          userId,
          subtotalPaisa,
          shippingPaisa,
        });

        const discountPaisa = applied?.discountPaisa ?? 0;
        const shippingDiscountPaisa = applied?.shippingDiscountPaisa ?? 0;

        // নম্বর transaction-এর ভেতরেই — লক ধরে রাখতে হয়
        const orderNumber = await this.orderNumbers.next(tx);

        const order = await tx.order.create({
          data: {
            orderNumber,
            userId,
            subtotalPaisa,
            shippingPaisa,
            discountPaisa,
            shippingDiscountPaisa,
            /**
             * মোট = পণ্য + ডেলিভারি − ছাড় − ডেলিভারির ছাড়।
             *
             * দুই ছাড় আলাদা রাখা হয় যাতে ইনভয়েসে "ডেলিভারি ১২০৳"
             * আর "ডেলিভারি ফ্রি" একসাথে না দেখায়, আর কুরিয়ারের
             * বিলের সাথে হিসাব মেলানো যায়।
             */
            totalPaisa: subtotalPaisa + shippingPaisa - discountPaisa - shippingDiscountPaisa,
            note: input.note ?? null,
            ...shipping,
            items: { create: lines },
            // খোলার মুহূর্তটাও ইতিহাসে থাকে — পরে কে কখন বদলালো মেলানো যায়
            history: { create: { toStatus: 'PENDING', note: 'Order placed' } },
          },
          select: ORDER_DETAIL_SELECT,
        });

        await this.recordCouponUse(tx, applied, userId, order.id);

        // অর্ডার হয়ে গেলে কার্ট খালি — নইলে ইউজার আবার একই অর্ডার দিয়ে ফেলবে
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

        return order;
      },
      {
        /**
         * ডিফল্ট timeout-এ অনেক আইটেমের অর্ডার আটকে যেতে পারে,
         * আর race-এ দ্বিতীয় transaction লকের জন্য অপেক্ষা করে।
         */
        timeout: 15_000,
      },
    );

    /**
     * COD ঝুঁকির হিসাব — **transaction শেষ হওয়ার পরে, ইচ্ছাকৃতভাবে**।
     *
     * ভেতরে রাখলে হিসাবের কোনো ভুল পুরো অর্ডার rollback করে দিত।
     * কাস্টমারের টাকা আর ইচ্ছা দুটোই আছে, স্টকও কমে গেছে — শুধু
     * একটা পরামর্শমূলক সংখ্যা বের করতে গিয়ে সেটা হারানো অর্থহীন।
     *
     * `checkOrder` নিজে কখনো throw করে না, তাই এখানে try লাগে না।
     * স্কোর অর্ডার আটকায় না — শুধু অ্যাডমিনকে দেখে নিতে বলে।
     */
    await this.fraud.checkOrder(created.id);

    return created;
  }

  /**
   * নিজের অর্ডারের তালিকা — **শুধু লগইন করা ক্রেতার জন্য**।
   *
   * `userId` এখানে কখনো `null` বা `undefined` হতে পারে না, আর
   * টাইপটাই সেটা আটকায়। `Order.userId` nullable হওয়ার পর এটা
   * গুরুত্বপূর্ণ হয়ে উঠেছে:
   *
   * - `undefined` গেলে Prisma শর্তটাই বাদ দিত আর **দোকানের সব
   *   অর্ডার** ফেরত আসত
   * - `null` গেলে **সব গেস্ট অর্ডার** ফেরত আসত
   *
   * গেস্টের জন্য এই পথ নেই — সে `/track`-এ অর্ডার নম্বর আর
   * ফোন দিয়ে দেখে, দুটোই জানা লাগে।
   */
  list(userId: string): Promise<OrderSummary[]> {
    return this.prisma.order.findMany({
      where: { userId },
      select: ORDER_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * `userId` শর্তে থাকা জরুরি — নম্বর অনুমান করে অন্যের অর্ডার
   * দেখা ঠেকায়। নম্বরে তারিখ আর সিরিয়াল থাকায় অনুমান করা সহজ।
   */
  async findOne(userId: string, orderNumber: string): Promise<OrderDetail> {
    const order = await this.prisma.order.findFirst({
      where: { orderNumber, userId },
      select: ORDER_DETAIL_SELECT,
    });

    if (!order) {
      throw new NotFoundException('অর্ডার পাওয়া যায়নি');
    }

    return order;
  }

  /**
   * সংরক্ষিত ঠিকানা, নয়তো চেকআউটে লেখা নতুন ঠিকানা।
   * দুই ক্ষেত্রেই অর্ডারে **কপি** বসে — ইউজার পরে ঠিকানা বদলালে বা
   * মুছলেও পুরোনো অর্ডার কোথায় গিয়েছিল তা জানা থাকে।
   */
  /**
   * গেস্টের ঠিকানা — শুধু অর্ডারে **কপি** বসে, কোথাও সংরক্ষিত হয় না।
   *
   * `Address` row বানানো যায় না: সেটা `userId` দাবি করে, আর গেস্টের
   * অ্যাকাউন্ট নেই। সংরক্ষণ না হওয়াটা সমস্যা নয় — গেস্ট পরের বার
   * এমনিতেও এই ঠিকানা ফিরে পেত না, কারণ তাকে চেনার কিছু নেই।
   * কুরিয়ারের দরকার শুধু snapshot-টা, আর সেটা অর্ডারেই থাকে।
   */
  private snapshotFromInput(input: CheckoutInput): ShippingSnapshot {
    if (input.address === undefined) {
      // schema-র refine এটা আগেই আটকায়; এখানে টাইপ সংকুচিত করার জন্য
      throw new BadRequestException('ঠিকানা দিন');
    }

    const fresh = input.address;

    return {
      // গেস্টের কোনো `Address` row নেই, তাই কিছুর সাথে জোড়া লাগে না
      addressId: null,
      shipFullName: fresh.fullName,
      shipPhone: fresh.phone,
      shipLine1: fresh.line1,
      shipLine2: fresh.line2 ?? null,
      shipCity: fresh.city,
      shipDistrict: fresh.district,
      shipPostcode: fresh.postcode ?? null,
    };
  }

  private async resolveShipping(
    owner: CartOwner,
    input: CheckoutInput,
  ): Promise<ShippingSnapshot> {
    /**
     * গেস্টের সংরক্ষিত ঠিকানা থাকতে পারে না — `Address` অ্যাকাউন্টের
     * সাথে বাঁধা। তাই `addressId` পাঠানো হলেও সেটা তার নয়।
     *
     * **এটা নীরবে উপেক্ষা করা হয় না।** উপেক্ষা করলে গেস্ট ভাবত
     * ঠিকানা গেছে, অথচ `input.address` না থাকায় নিচে "ঠিকানা দিন"
     * বলত — বিভ্রান্তিকর। আর আইডিটা যদি সত্যিই কারো ঠিকানা হয়,
     * অনুমান করে অন্যের ঠিকানায় পণ্য পাঠানোর চেষ্টা হতো।
     */
    if (owner.kind === 'guest') {
      if (input.addressId !== undefined) {
        throw new BadRequestException('সংরক্ষিত ঠিকানা ব্যবহার করতে লগইন করুন');
      }

      return this.snapshotFromInput(input);
    }

    const userId = owner.userId;

    if (input.addressId !== undefined) {
      const address = await this.prisma.address.findFirst({
        where: { id: input.addressId, userId },
      });

      if (!address) {
        throw new NotFoundException('ঠিকানা পাওয়া যায়নি');
      }

      return {
        addressId: address.id,
        shipFullName: address.fullName,
        shipPhone: address.phone,
        shipLine1: address.line1,
        shipLine2: address.line2,
        shipCity: address.city,
        shipDistrict: address.district,
        shipPostcode: address.postcode,
      };
    }

    if (input.address === undefined) {
      // schema-র refine এটা আগেই আটকায়; এখানে টাইপ সংকুচিত করার জন্য
      throw new BadRequestException('ঠিকানা দিন');
    }

    const fresh = input.address;

    /**
     * চেকআউটে লেখা ঠিকানা সংরক্ষিতও হয় — পরের বার ইউজারকে
     * আবার টাইপ করতে হবে না।
     */
    const saved = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.count({ where: { userId } });

      return tx.address.create({
        data: {
          userId,
          label: fresh.label ?? null,
          fullName: fresh.fullName,
          phone: fresh.phone,
          line1: fresh.line1,
          line2: fresh.line2 ?? null,
          city: fresh.city,
          district: fresh.district,
          postcode: fresh.postcode ?? null,
          isDefault: existing === 0,
        },
      });
    });

    return {
      addressId: saved.id,
      shipFullName: saved.fullName,
      shipPhone: saved.phone,
      shipLine1: saved.line1,
      shipLine2: saved.line2,
      shipCity: saved.city,
      shipDistrict: saved.district,
      shipPostcode: saved.postcode,
    };
  }
}
