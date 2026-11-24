import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { summarizePayments } from '@shop/shared';
import { PrismaService } from '../../../prisma/prisma.service';

const INVOICE_SELECT = {
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
      productName: true,
      variantSku: true,
      optionsText: true,
      unitPricePaisa: true,
      quantity: true,
      lineTotalPaisa: true,
    },
  },
  payments: {
    select: {
      id: true,
      amountPaisa: true,
      method: true,
      status: true,
      reference: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.OrderSelect;

type InvoiceRow = Prisma.OrderGetPayload<{ select: typeof INVOICE_SELECT }>;

export interface InvoiceView extends InvoiceRow {
  paidPaisa: number;
  duePaisa: number;
}

/**
 * ইনভয়েসের **ডেটা** — PDF নয়।
 *
 * PDF সার্ভারে বানাতে headless Chrome লাগে, যা মেমরি খায় আর deploy
 * ভারী করে। ডেটা দিলে web থেকে ব্রাউজারের নিজের print দিয়েই ছাপা যায়।
 *
 * অঙ্ক সার্ভারেই হিসাব হয় — ক্লায়েন্টে বানালে ইনভয়েসের টাকা
 * বদলে দেওয়া যেত।
 */
@Injectable()
export class InvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  async build(orderNumber: string): Promise<InvoiceView> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: INVOICE_SELECT,
    });

    if (!order) {
      throw new NotFoundException('অর্ডার পাওয়া যায়নি');
    }

    // due হিসাব এক জায়গায় — payment module-এর সাথে একই ফাংশন
    const summary = summarizePayments(order.totalPaisa, order.payments);

    return {
      ...order,
      paidPaisa: summary.paidPaisa,
      duePaisa: summary.duePaisa,
    };
  }
}
