import type { PaymentMethod } from '@shop/shared';

/**
 * পেমেন্ট গেটওয়ের চুক্তি। **এখন কোনো আসল গেটওয়ে নেই** — সব টাকা
 * COD বা হাতে লেখা এন্ট্রি। এই interface আগেই লেখা হচ্ছে যাতে পরে
 * bKash/SSLCommerz যোগ করতে গিয়ে `PaymentsService` ছুঁতে না হয়।
 *
 * কেন interface, সরাসরি bKash SDK নয়: গেটওয়ে বদলানো বাংলাদেশে
 * সাধারণ ঘটনা (চার্জ, downtime, merchant অ্যাকাউন্ট সমস্যা)। adapter
 * আলাদা থাকলে বদলানো মানে একটা ফাইল যোগ করা, পুরো service লেখা নয়।
 */
export interface PaymentInitResult {
  /** কাস্টমারকে যেখানে পাঠাতে হবে — manual-এ কিছু নেই */
  redirectUrl: string | null;
  /** গেটওয়ের নিজের আইডি, পরে webhook মেলাতে লাগে */
  providerReference: string | null;
}

export interface PaymentVerifyResult {
  isPaid: boolean;
  /** গেটওয়ে যা বলছে — আমাদের হিসাবের সাথে মেলানো হবে */
  amountPaisa: number | null;
  providerReference: string | null;
}

export interface PaymentProvider {
  readonly method: PaymentMethod;

  /** টাকা নেওয়ার প্রক্রিয়া শুরু। manual-এ কিছুই করার নেই। */
  initiate(input: {
    orderNumber: string;
    amountPaisa: number;
  }): Promise<PaymentInitResult>;

  /**
   * টাকা সত্যিই এসেছে কিনা গেটওয়েকে জিজ্ঞেস করা।
   *
   * **কখনোই** ক্লায়েন্টের "পেমেন্ট সফল" দাবিতে বিশ্বাস করা হবে না —
   * ব্রাউজার থেকে আসা success callback জাল করা যায়, তাই সবসময়
   * সার্ভার থেকে গেটওয়েকে জিজ্ঞেস করে নিশ্চিত হতে হবে।
   */
  verify(providerReference: string): Promise<PaymentVerifyResult>;
}

/**
 * হাতে লেখা পেমেন্টের adapter — বিকাশে টাকা এসেছে, অ্যাডমিন লিখে দিল।
 *
 * গেটওয়ে নেই, তাই `initiate` কিছু করে না আর `verify` সবসময় বলে
 * "আমি জানি না" (`isPaid: false`)। মানুষই এখানে যাচাইকারী — সে
 * বিকাশের SMS দেখে TrxID মিলিয়ে এন্ট্রি দেয়।
 */
export class ManualPaymentProvider implements PaymentProvider {
  constructor(readonly method: PaymentMethod) {}

  initiate(): Promise<PaymentInitResult> {
    return Promise.resolve({ redirectUrl: null, providerReference: null });
  }

  verify(): Promise<PaymentVerifyResult> {
    return Promise.resolve({ isPaid: false, amountPaisa: null, providerReference: null });
  }
}
