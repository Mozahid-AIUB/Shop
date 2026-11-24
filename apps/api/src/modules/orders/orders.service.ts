import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CheckoutInput } from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { formatOptions } from './cart.service';
import { FraudService } from './fraud.service';
import { OrderNumberService } from './order-number.service';

const ORDER_LIST_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  subtotalPaisa: true,
  shippingPaisa: true,
  discountPaisa: true,
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
  ) {}

  /**
   * চেকআউট। একটা transaction-এ সব — নম্বর, স্টক, অর্ডার।
   * যেকোনো ধাপ ব্যর্থ হলে পুরোটা rollback, তাই স্টক কমে কিন্তু
   * অর্ডার তৈরি হয়নি এমন অবস্থা হয় না।
   *
   * দাম **কোথাও** ইনপুট থেকে আসে না — সব DB থেকে পড়া হয়।
   */
  async checkout(userId: string, input: CheckoutInput): Promise<OrderDetail> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
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

    const shipping = await this.resolveShipping(userId, input);

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
     * শিপিং আর ডিসকাউন্ট এখনো ০ — Phase 05/09-এ নিয়ম যোগ হবে।
     * ফিল্ডগুলো এখনই আছে যাতে পরে schema বদলাতে না হয়।
     */
    const shippingPaisa = 0;
    const discountPaisa = 0;

    const created = await this.prisma.$transaction(
      async (tx) => {
        /**
         * স্টক কমানো — conditional update, এটাই oversell-এর আসল রক্ষা।
         * `stock: { gte: quantity }` শর্তে না মিললে `count` ০ আসে, তখন
         * আমরা throw করি আর পুরো transaction rollback হয়।
         *
         * আগে পড়ে তারপর লেখা (read-then-write) করলে দুটো চেকআউট একই
         * স্টক পড়ে দুটোই পাস করে ফেলত।
         */
        for (const line of lines) {
          const updated = await tx.productVariant.updateMany({
            where: { id: line.variantId, stock: { gte: line.quantity } },
            data: { stock: { decrement: line.quantity } },
          });

          if (updated.count === 0) {
            throw new ConflictException(`"${line.productName}" স্টকে নেই`);
          }
        }

        // নম্বর transaction-এর ভেতরেই — লক ধরে রাখতে হয়
        const orderNumber = await this.orderNumbers.next(tx);

        const order = await tx.order.create({
          data: {
            orderNumber,
            userId,
            subtotalPaisa,
            shippingPaisa,
            discountPaisa,
            totalPaisa: subtotalPaisa + shippingPaisa - discountPaisa,
            note: input.note ?? null,
            ...shipping,
            items: { create: lines },
            // খোলার মুহূর্তটাও ইতিহাসে থাকে — পরে কে কখন বদলালো মেলানো যায়
            history: { create: { toStatus: 'PENDING', note: 'Order placed' } },
          },
          select: ORDER_DETAIL_SELECT,
        });

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
  private async resolveShipping(userId: string, input: CheckoutInput): Promise<ShippingSnapshot> {
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
