import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Shipment } from '@prisma/client';
import {
  SHIPMENT_TO_ORDER_STATUS,
  isShipmentTerminal,
  type Courier,
  type DispatchInput,
  type ShipmentStatus,
  type ShipmentStatusUpdate,
} from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderLifecycleService } from '../orders/order-lifecycle.service';
import { CourierAccountService } from './courier-account.service';
import { CourierRegistry } from './courier.registry';
import type { ParcelRequest } from './courier.provider';

/**
 * অর্ডার → পার্সেল।
 *
 * **অর্ডার আর পার্সেল আলাদা** কারণ একটা অর্ডার ফেরত এসে আবার
 * পাঠানো হতে পারে — তখন দুটো পার্সেল, একই অর্ডার।
 *
 * **কুরিয়ারের API কল transaction-এর বাইরে**, ইচ্ছাকৃতভাবে। ভেতরে
 * রাখলে কুরিয়ারের ধীর উত্তরের জন্য DB-র লক ধরে বসে থাকতে হতো, আর
 * timeout হলে পার্সেল কুরিয়ারের দিকে তৈরি হয়ে যেত কিন্তু আমাদের
 * দিকে rollback হতো — মানে পার্সেল গেছে অথচ আমরা জানি না।
 */
/** পাঠানোর যোগ্য অর্ডারের যতটুকু দরকার। */
type DispatchableOrder = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  totalPaisa: number;
  shipFullName: string;
  shipPhone: string;
  shipLine1: string;
  shipLine2: string | null;
  shipCity: string;
  shipDistrict: string;
  items: { productName: string; optionsText: string | null; quantity: number }[];
  shipments: { id: string; status: ShipmentStatus }[];
};

@Injectable()
export class CourierService {
  private readonly logger = new Logger(CourierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: CourierAccountService,
    private readonly registry: CourierRegistry,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  /**
   * অর্ডার কুরিয়ারে পাঠানো — এক ক্লিক।
   *
   * ধাপগুলোর ক্রম গুরুত্বপূর্ণ:
   * ১. অর্ডার যাচাই (ছাপা হয়েছে? আগে পাঠানো হয়নি?)
   * ২. `Shipment` row তৈরি — **কুরিয়ারে কল করার আগে**
   * ৩. কুরিয়ারে কল
   * ৪. ফল অনুযায়ী row আপডেট
   *
   * ধাপ ২ আগে করা হয় যাতে কুরিয়ারে পার্সেল তৈরি হয়ে গেলেও আমাদের
   * দিকে কিছু না থাকার অবস্থা না আসে। ব্যর্থ হলে row-টা
   * `lastError` নিয়ে পড়ে থাকে, আর অ্যাডমিন দেখে বুঝতে পারে কী হলো।
   */
  async dispatch(
    orderNumber: string,
    input: DispatchInput,
    actorId: string,
  ): Promise<Shipment> {
    const order = await this.loadDispatchableOrder(orderNumber);

    const { account, credentials } = await this.accounts.resolveForDispatch(input.courier);
    const provider = this.registry.get(account.kind);

    /**
     * API-ওয়ালা কুরিয়ারে ট্র্যাকিং নম্বর হাতে বসানো যায় না।
     *
     * নম্বর তারাই দেয়; হাতে বসালে ভুল নম্বর ক্রেতার কাছে চলে যেত
     * আর সে কুরিয়ারের সাইটে কিছু খুঁজে পেত না।
     */
    if (provider.hasApi && input.trackingCode !== undefined) {
      throw new BadRequestException(
        `${account.label}-এ ট্র্যাকিং নম্বর কুরিয়ার নিজে দেয়, হাতে বসানো যায় না`,
      );
    }

    /**
     * COD-তে কুরিয়ার কত তুলবে।
     *
     * পেমেন্ট হয়ে গেলে `0` — নইলে কুরিয়ার আবার টাকা চাইত আর ক্রেতা
     * দুবার দিত।
     */
    const codAmountPaisa = order.paymentStatus === 'PAID' ? 0 : order.totalPaisa;

    /**
     * row আগে তৈরি, **কুরিয়ারে কল করার আগে**।
     *
     * উল্টো করলে কুরিয়ারে পার্সেল তৈরি হয়ে যেতে পারত অথচ আমাদের
     * দিকে কিছুই নেই — পার্সেল গেছে, আমরা জানি না।
     */
    const shipment = await this.prisma.shipment.create({
      data: {
        orderId: order.id,
        courierAccountId: account.id,
        courier: account.kind,
        codAmountPaisa,
        trackingCode: input.trackingCode ?? null,
        events: { create: { status: 'PENDING', note: 'পার্সেল তৈরি' } },
      },
    });

    const result = await provider.createParcel(
      this.toParcelRequest(order, codAmountPaisa, input.note ?? null),
      { credentials, isSandbox: account.isSandbox },
    );

    if (!result.ok) {
      /**
       * ব্যর্থতা row-তে লিখে রাখা হয়, throw করার আগে।
       *
       * না লিখলে অ্যাডমিন শুধু ত্রুটির বার্তা দেখত আর পাতা
       * refresh করলে সেটাও হারাত — তখন "কাজ করছে না" ছাড়া কিছু
       * বলার থাকত না।
       */
      await this.prisma.shipment.update({
        where: { id: shipment.id },
        data: { lastError: result.message, status: 'CANCELLED' },
      });

      throw new BadRequestException(result.message);
    }

    const dispatched = await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        consignmentId: result.consignmentId,
        /**
         * `MANUAL`-এ অ্যাডমিনের বসানো নম্বর রাখা হয়; API-ওয়ালা
         * কুরিয়ারে তাদের দেওয়া নম্বর।
         */
        trackingCode: result.trackingCode ?? input.trackingCode ?? null,
        courierFeePaisa: result.feePaisa,
        dispatchedAt: new Date(),
        lastError: null,
      },
    });

    /**
     * অর্ডার `SHIPPED` — পার্সেল তৈরি হলে সাথে সাথেই।
     *
     * আলাদা করে বদলাতে হলে অ্যাডমিন একটা ভুলে যেত, আর ক্রেতা
     * ট্র্যাকিং পাতায় "ছাপা হয়েছে" দেখে ভাবত পাঠানো হয়নি।
     *
     * আগে থেকেই `SHIPPED` হলে কিছু করা হয় না (ফেরত আসার পর আবার
     * পাঠানো)।
     */
    if (order.status === 'PRINTED') {
      await this.lifecycle.markShipped(order.id, actorId, account.label);
    }

    return dispatched;
  }

  /**
   * অর্ডার তুলে এনে যাচাই — পাঠানোর যোগ্য কিনা।
   *
   * আলাদা method রাখা হয়েছে কারণ এটা **নিয়ম**, আর নিয়মগুলো এক
   * জায়গায় থাকলে পড়া সহজ: কখন পাঠানো যায়, কখন যায় না।
   */
  private async loadDispatchableOrder(orderNumber: string): Promise<DispatchableOrder> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        totalPaisa: true,
        shipFullName: true,
        shipPhone: true,
        shipLine1: true,
        shipLine2: true,
        shipCity: true,
        shipDistrict: true,
        items: { select: { productName: true, optionsText: true, quantity: true } },
        shipments: { select: { id: true, status: true } },
      },
    });

    if (order === null) {
      throw new NotFoundException('অর্ডার পাওয়া যায়নি');
    }

    /**
     * ছাপা হওয়ার আগে পাঠানো যায় না।
     *
     * পণ্য তৈরি না হতেই রাইডার পাঠালে সে খালি হাতে ফিরত, আর
     * কুরিয়ারের খরচটা জলে যেত।
     *
     * `SHIPPED`-ও চলে: ফেরত আসা পার্সেল আবার পাঠানোর সময় অর্ডার
     * তখনো `SHIPPED`-এই থাকে।
     */
    if (order.status !== 'PRINTED' && order.status !== 'SHIPPED') {
      throw new ConflictException(
        `অর্ডারটা এখনো ${order.status} — ছাপা হওয়ার পর পাঠানো যাবে`,
      );
    }

    /**
     * **একই অর্ডার দুবার পাঠানো যাবে না।**
     *
     * দুবার পাঠালে দুজন রাইডার একই ঠিকানায় হাজির হতো, আর COD-র
     * টাকা দুবার তোলার চেষ্টা হতো।
     *
     * ফেরত বা বাতিল হওয়া পার্সেল গোনা হয় না — তখন আবার পাঠানোই
     * উদ্দেশ্য।
     */
    const live = order.shipments.find((shipment) => !isShipmentTerminal(shipment.status));

    if (live !== undefined) {
      throw new ConflictException('এই অর্ডার আগেই কুরিয়ারে পাঠানো হয়েছে');
    }

    return order;
  }

  /**
   * অর্ডার থেকে কুরিয়ারের পার্সেল।
   *
   * **সব অর্ডার থেকে পড়া, ক্লায়েন্ট থেকে কিছু নয়** — COD-র অঙ্ক
   * ইনপুট হলে কেউ কম বসিয়ে দিত আর কুরিয়ার কম টাকা তুলে আনত।
   */
  private toParcelRequest(
    order: DispatchableOrder,
    codAmountPaisa: number,
    note: string | null,
  ): ParcelRequest {
    return {
      orderNumber: order.orderNumber,
      /**
       * পুনঃপ্রেরণে আলাদা reference।
       *
       * কুরিয়াররা একই invoice দুবার নেয় না। আগের পার্সেলগুলো গোনা
       * হয় (ফেরত আসা সহ), তাই দ্বিতীয়বারে `-R2` যায়। না করলে
       * ফেরত আসা পণ্য আর কখনো পাঠানো যেত না।
       */
      parcelReference:
        order.shipments.length === 0
          ? order.orderNumber
          : `${order.orderNumber}-R${order.shipments.length + 1}`,
      recipientName: order.shipFullName,
      recipientPhone: order.shipPhone,
      recipientAddress: [order.shipLine1, order.shipLine2].filter(Boolean).join(', '),
      recipientCity: order.shipCity,
      recipientDistrict: order.shipDistrict,
      codAmountPaisa,
      itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      itemDescription: order.items
        .map((item) =>
          item.optionsText === null
            ? `${item.quantity} x ${item.productName}`
            : `${item.quantity} x ${item.productName} (${item.optionsText})`,
        )
        .join(', '),
      note,
    };
  }

  /**
   * পার্সেলের অবস্থা বদলানো — অ্যাডমিন হাতে, বা webhook থেকে।
   *
   * **দুই পথেই এই একটাই method**, যাতে নিয়ম আলাদা না হয়: পিছিয়ে
   * যাওয়া ঠেকানো, ইতিহাস লেখা, অর্ডারের অবস্থা মেলানো — সব এক
   * জায়গায়।
   */
  async updateStatus(
    shipmentId: string,
    input: ShipmentStatusUpdate & { rawStatus?: string | null; occurredAt?: Date | null },
    actorId: string | null,
  ): Promise<Shipment> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, orderId: true, order: { select: { status: true } } },
    });

    if (shipment === null) {
      throw new NotFoundException('পার্সেল পাওয়া যায়নি');
    }

    /**
     * **শেষ হয়ে যাওয়া পার্সেল পিছিয়ে যাবে না।**
     *
     * কুরিয়ারের webhook ক্রমে আসে না — দেরিতে আসা "IN_TRANSIT"
     * পরে এলে পার্সেল পিছিয়ে যেত আর অ্যাডমিন ভাবত হারিয়ে গেছে।
     *
     * একই অবস্থা আবার এলে ত্রুটি নয়, চুপচাপ মেনে নেওয়া হয় —
     * duplicate webhook স্বাভাবিক ঘটনা।
     */
    if (isShipmentTerminal(shipment.status) && shipment.status !== input.status) {
      throw new ConflictException(
        `পার্সেল আগেই ${shipment.status} — আর বদলানো যাবে না`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.shipment.update({
        where: { id: shipmentId },
        data: {
          status: input.status,
          rawStatus: input.rawStatus ?? undefined,
          failureReason: input.failureReason ?? undefined,
          deliveredAt: input.status === 'DELIVERED' ? new Date() : undefined,
        },
      });

      await this.recordEvent(tx, shipmentId, input);

      return next;
    });

    await this.syncOrderStatus(shipment.orderId, shipment.order.status, input.status, actorId);

    return updated;
  }

  /**
   * webhook থেকে আসা আপডেট — consignment id ধরে পার্সেল খুঁজে।
   *
   * পার্সেল না পাওয়া গেলে **ত্রুটি নয়**: কুরিয়ার অন্য দোকানের
   * webhook ভুল করে পাঠাতে পারে, বা আমাদের row মুছে গেছে। ত্রুটি
   * দিলে কুরিয়ার বারবার retry করত আর তাদের queue আটকে থাকত।
   */
  async applyWebhook(
    courier: Courier,
    update: {
      consignmentId: string;
      status: ShipmentStatus;
      rawStatus: string | null;
      occurredAt: Date | null;
      note: string | null;
    },
  ): Promise<void> {
    const shipment = await this.prisma.shipment.findUnique({
      where: { courier_consignmentId: { courier, consignmentId: update.consignmentId } },
      select: { id: true },
    });

    if (shipment === null) {
      this.logger.warn(
        `Webhook for unknown ${courier} consignment ${update.consignmentId} — ignored`,
      );

      return;
    }

    try {
      await this.updateStatus(
        shipment.id,
        {
          status: update.status,
          note: update.note ?? undefined,
          rawStatus: update.rawStatus,
          occurredAt: update.occurredAt,
        },
        null,
      );
    } catch (error) {
      /**
       * পিছিয়ে যাওয়ার চেষ্টা (`409`) এখানে **স্বাভাবিক** — তাই
       * গিলে ফেলা হয়, কুরিয়ারকে ২০০ ফেরানো হয়। ত্রুটি দিলে তারা
       * একই webhook চিরকাল retry করত।
       */
      this.logger.warn(
        `Webhook for ${courier} ${update.consignmentId} not applied: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * ইতিহাসে ঘটনা লেখা।
   *
   * `@@unique([shipmentId, status, occurredAt])` থাকায় duplicate
   * webhook দ্বিতীয়বার row বানায় না — সেই সংঘর্ষটা এখানে গিলে
   * ফেলা হয়, কারণ duplicate webhook কোনো সমস্যা নয়।
   */
  private async recordEvent(
    tx: Prisma.TransactionClient,
    shipmentId: string,
    input: { status: ShipmentStatus; note?: string; rawStatus?: string | null; occurredAt?: Date | null },
  ): Promise<void> {
    try {
      await tx.shipmentEvent.create({
        data: {
          shipmentId,
          status: input.status,
          rawStatus: input.rawStatus ?? null,
          note: input.note ?? null,
          occurredAt: input.occurredAt ?? null,
        },
      });
    } catch {
      // একই ঘটনা দুবার — ইতিহাসে একটাই থাকবে
    }
  }

  /**
   * পার্সেলের অবস্থা অর্ডারে মেলানো।
   *
   * `RETURNED` অর্ডার বাতিল **করে না**: ফেরত মানে ক্রেতা নেয়নি,
   * কিন্তু পণ্য দোকানে ফিরেছে আর টাকার হিসাব এখনো বাকি। রিফান্ড?
   * আবার পাঠানো? সিদ্ধান্তটা মানুষের।
   */
  private async syncOrderStatus(
    orderId: string,
    currentOrderStatus: string,
    shipmentStatus: ShipmentStatus,
    actorId: string | null,
  ): Promise<void> {
    const target = SHIPMENT_TO_ORDER_STATUS[shipmentStatus];

    if (target === null || target === currentOrderStatus) {
      return;
    }

    if (target === 'DELIVERED') {
      await this.lifecycle.markDelivered(orderId, actorId);
    }
  }
}
