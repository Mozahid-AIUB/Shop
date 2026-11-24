import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACTIVITY_ACTIONS,
  summarizePayments,
  type PaymentSummary,
  type RecordPaymentInput,
  type VoidPaymentInput,
} from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../admin/activity-log/activity-log.service';

const PAYMENT_SELECT = {
  id: true,
  amountPaisa: true,
  method: true,
  status: true,
  reference: true,
  note: true,
  voidedAt: true,
  voidReason: true,
  createdAt: true,
  recordedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.PaymentSelect;

export type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

/** অর্ডারের টাকার পুরো ছবি — সারাংশ + প্রতিটা এন্ট্রি। */
export interface PaymentsView extends PaymentSummary {
  orderNumber: string;
  payments: PaymentRow[];
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  /**
   * কাস্টমারের জন্য — `userId` শর্তে, তাই অন্যের অর্ডারের টাকার
   * হিসাব দেখা যায় না (404, "নেই" আর "তোমার নয়" একই উত্তর)।
   */
  viewForCustomer(userId: string, orderNumber: string): Promise<PaymentsView> {
    return this.view(orderNumber, userId);
  }

  /** staff-এর জন্য — যেকোনো অর্ডার। */
  viewForStaff(orderNumber: string): Promise<PaymentsView> {
    return this.view(orderNumber);
  }

  /**
   * পেমেন্ট লেখা। due-র বেশি নেওয়া যায় না, আর লেখার সাথে সাথে
   * `Order.paymentStatus` সার্ভার নিজে নতুন করে হিসাব করে।
   *
   * সবটা একটা transaction-এ: পেমেন্ট বসলো কিন্তু status বদলালো না —
   * এমন অর্ধেক অবস্থা হয় না।
   */
  async record(
    orderNumber: string,
    input: RecordPaymentInput,
    recordedById: string,
  ): Promise<PaymentsView> {
    const order = await this.findOrder(orderNumber);
    const summary = summarizePayments(order.totalPaisa, order.payments);

    /**
     * বেশি টাকা আটকানো হচ্ছে কারণ বাড়তি অঙ্ক কোথা থেকে এলো সেটা
     * পরে কেউ মেলাতে পারে না। বেশি এলে আলাদা refund row হবে।
     */
    if (input.amountPaisa > summary.duePaisa) {
      throw new ConflictException(
        summary.duePaisa === 0
          ? 'এই অর্ডারের টাকা পুরো পরিশোধিত'
          : `বাকি আছে ${summary.duePaisa / 100} টাকা — এর বেশি নেওয়া যাবে না`,
      );
    }

    let paymentId = '';

    try {
      await this.prisma.$transaction(async (tx) => {
        const created = await tx.payment.create({
          data: {
            orderId: order.id,
            amountPaisa: input.amountPaisa,
            method: input.method,
            reference: input.reference ?? null,
            note: input.note ?? null,
            recordedById,
          },
          select: { id: true },
        });

        paymentId = created.id;

        await this.syncOrderStatus(tx, order.id, order.totalPaisa);
      });
    } catch (error) {
      // একই TrxID দুবার — `@@unique([method, reference])` ধরে ফেলে
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('এই রেফারেন্স নম্বরে আগেই একটা পেমেন্ট লেখা আছে');
      }

      throw error;
    }

    // transaction-এর বাইরে — rollback হলে লগও থাকা উচিত নয়
    await this.activity.record({
      actorId: recordedById,
      action: ACTIVITY_ACTIONS.PAYMENT_RECORDED,
      entityType: 'Payment',
      entityId: paymentId,
      summary: `${input.method} ${input.amountPaisa / 100} টাকা on ${orderNumber}`,
    });

    return this.view(orderNumber);
  }

  /**
   * ভুল এন্ট্রি বাতিল। row **মোছা হয় না** — status `VOIDED` হয়,
   * যোগফল থেকে বাদ পড়ে, কিন্তু কে কখন কেন বাতিল করলো তা থেকে যায়।
   * টাকার হিসাবে মুছে ফেলা মানে অডিটে প্রশ্নের উত্তর না থাকা।
   */
  async void(
    paymentId: string,
    input: VoidPaymentInput,
    voidedById: string,
  ): Promise<PaymentsView> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        status: true,
        order: { select: { id: true, orderNumber: true, totalPaisa: true } },
      },
    });

    if (!payment) {
      throw new NotFoundException('পেমেন্ট পাওয়া যায়নি');
    }

    if (payment.status !== 'RECEIVED') {
      throw new ConflictException('এই পেমেন্ট আগেই বাতিল বা ফেরত হয়েছে');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidReason: input.reason,
        },
      });

      await this.syncOrderStatus(tx, payment.order.id, payment.order.totalPaisa);
    });

    await this.activity.record({
      actorId: voidedById,
      action: ACTIVITY_ACTIONS.PAYMENT_VOIDED,
      entityType: 'Payment',
      entityId: payment.id,
      summary: `voided: ${input.reason}`,
    });

    return this.view(payment.order.orderNumber);
  }

  /**
   * `Order.paymentStatus` row-গুলো থেকে নতুন করে হিসাব করে বসায়।
   *
   * এটা জমানো অঙ্ক নয়, শুধু দ্রুত ফিল্টারের জন্য রাখা **সারাংশ** —
   * সত্য সবসময় payment row-এ। তাই প্রতিবার পুরোটা আবার গোনা হয়,
   * আগের মানের উপর যোগ-বিয়োগ করা হয় না।
   */
  private async syncOrderStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
    totalPaisa: number,
  ): Promise<void> {
    const payments = await tx.payment.findMany({
      where: { orderId },
      select: { amountPaisa: true, status: true },
    });

    const summary = summarizePayments(totalPaisa, payments);

    await tx.order.update({
      where: { id: orderId },
      data: { paymentStatus: summary.status },
    });
  }

  private async findOrder(
    orderNumber: string,
    userId?: string,
  ): Promise<{
    id: string;
    totalPaisa: number;
    payments: { amountPaisa: number; status: 'RECEIVED' | 'VOIDED' | 'REFUNDED' }[];
  }> {
    const order = await this.prisma.order.findFirst({
      where: { orderNumber, ...(userId === undefined ? {} : { userId }) },
      select: {
        id: true,
        totalPaisa: true,
        payments: { select: { amountPaisa: true, status: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('অর্ডার পাওয়া যায়নি');
    }

    return order;
  }

  private async view(orderNumber: string, userId?: string): Promise<PaymentsView> {
    const order = await this.findOrder(orderNumber, userId);

    const payments = await this.prisma.payment.findMany({
      where: { orderId: order.id },
      select: PAYMENT_SELECT,
      orderBy: { createdAt: 'asc' },
    });

    return {
      orderNumber,
      ...summarizePayments(order.totalPaisa, payments),
      payments,
    };
  }
}
