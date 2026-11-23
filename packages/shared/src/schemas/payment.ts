import { z } from 'zod';
import { paisaSchema } from './catalog';
import {
  PAYMENT_METHODS,
  requiresReference,
  type PaymentMethod,
  type PaymentRecordStatus,
} from '../constants/payment';

/**
 * পেমেন্ট লেখার validation। সব টাকা **integer paisa** —
 * ৫০০ টাকা = 50000।
 */

export const recordPaymentSchema = z
  .object({
    /** ০ টাকার পেমেন্ট অর্থহীন, তাই অন্তত ১ পয়সা */
    amountPaisa: paisaSchema.refine((value) => value > 0, 'টাকার অঙ্ক শূন্যের বেশি হতে হবে'),
    method: z.enum(PAYMENT_METHODS),
    /** বিকাশের TrxID বা ব্যাংক slip নম্বর */
    reference: z.string().trim().min(3, 'রেফারেন্স অন্তত ৩ অক্ষর').max(80).nullable().optional(),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .refine(
    (value) =>
      !requiresReference(value.method) ||
      (value.reference !== null && value.reference !== undefined),
    {
      // TrxID ছাড়া বিকাশের টাকা পরে মেলানো যায় না — কে কখন পাঠালো অজানা থাকে
      message: 'এই মাধ্যমে TrxID বা রেফারেন্স নম্বর দিতে হবে',
      path: ['reference'],
    },
  );

export const voidPaymentSchema = z.object({
  /** কারণ বাধ্যতামূলক — অডিটে "কেন বাতিল" প্রশ্নের উত্তর থাকতে হবে */
  reason: z.string().trim().min(3, 'বাতিলের কারণ লিখুন').max(300),
});

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type VoidPaymentInput = z.infer<typeof voidPaymentSchema>;

/** যোগফলে গোনা হয় শুধু `RECEIVED` — বাতিল বা ফেরত টাকা নয়। */
export interface PaymentLike {
  amountPaisa: number;
  status: PaymentRecordStatus;
}

/**
 * অর্ডারের টাকার সারাংশ। `Order`-এ কিছু জমানো থাকে না —
 * প্রতিবার পেমেন্ট row থেকে হিসাব হয়, তাই একটাই সত্য থাকে।
 */
export interface PaymentSummary {
  totalPaisa: number;
  paidPaisa: number;
  duePaisa: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'REFUNDED';
}

/**
 * কত এসেছে, কত বাকি, আর সেই অনুযায়ী status।
 *
 * pure ফাংশন — DB ছাড়া টেস্ট করা যায়, আর API ও web দুই পাশেই
 * একই হিসাব চলে (UI-তে "বাকি ৫০০ টাকা" দেখাতে এটাই ব্যবহার হবে)।
 */
export function summarizePayments(
  totalPaisa: number,
  payments: readonly PaymentLike[],
): PaymentSummary {
  const received = payments.filter((payment) => payment.status === 'RECEIVED');
  const refunded = payments.filter((payment) => payment.status === 'REFUNDED');

  const paidPaisa = received.reduce((sum, payment) => sum + payment.amountPaisa, 0);
  const duePaisa = Math.max(totalPaisa - paidPaisa, 0);

  return {
    totalPaisa,
    paidPaisa,
    duePaisa,
    status: resolveStatus({ totalPaisa, paidPaisa, hasRefund: refunded.length > 0 }),
  };
}

function resolveStatus(input: {
  totalPaisa: number;
  paidPaisa: number;
  hasRefund: boolean;
}): PaymentSummary['status'] {
  /**
   * ফেরত দেওয়া হয়েছে আর এখন কিছুই পাওনা নেই — REFUNDED।
   * আংশিক ফেরতের পর টাকা বাকি থাকলে সেটা আর REFUNDED নয়,
   * নিচের সাধারণ নিয়মেই পড়বে।
   */
  if (input.hasRefund && input.paidPaisa === 0) {
    return 'REFUNDED';
  }

  if (input.paidPaisa === 0) {
    return 'UNPAID';
  }

  return input.paidPaisa >= input.totalPaisa ? 'PAID' : 'PARTIAL';
}
