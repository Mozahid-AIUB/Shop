import { summarizePayments, type PaymentLike } from '@shop/shared';

/**
 * টাকার হিসাব — pure ফাংশন, DB ছাড়াই টেস্ট।
 *
 * সব অঙ্ক **integer paisa**-তে: ১০০০ টাকা = 100000।
 * এখানে ভুল হলে দোকান হয় কম টাকা নেবে, নয় কাস্টমারকে দুবার চার্জ করবে।
 */
describe('summarizePayments', () => {
  const TOTAL = 100_000; // ১০০০ টাকা

  const received = (amountPaisa: number): PaymentLike => ({ amountPaisa, status: 'RECEIVED' });
  const voided = (amountPaisa: number): PaymentLike => ({ amountPaisa, status: 'VOIDED' });
  const refunded = (amountPaisa: number): PaymentLike => ({ amountPaisa, status: 'REFUNDED' });

  it('reports the full amount due when nothing has been paid', () => {
    expect(summarizePayments(TOTAL, [])).toEqual({
      totalPaisa: TOTAL,
      paidPaisa: 0,
      duePaisa: TOTAL,
      status: 'UNPAID',
    });
  });

  it('marks a part payment as PARTIAL and keeps the rest due', () => {
    const summary = summarizePayments(TOTAL, [received(40_000)]);

    expect(summary.paidPaisa).toBe(40_000);
    expect(summary.duePaisa).toBe(60_000);
    expect(summary.status).toBe('PARTIAL');
  });

  /** অগ্রিম + ডেলিভারিতে বাকিটা — বাংলাদেশে কাস্টম অর্ডারে স্বাভাবিক। */
  it('adds up several payments', () => {
    const summary = summarizePayments(TOTAL, [received(50_000), received(50_000)]);

    expect(summary.paidPaisa).toBe(TOTAL);
    expect(summary.duePaisa).toBe(0);
    expect(summary.status).toBe('PAID');
  });

  it('does not count a voided payment', () => {
    const summary = summarizePayments(TOTAL, [received(40_000), voided(60_000)]);

    expect(summary.paidPaisa).toBe(40_000);
    expect(summary.duePaisa).toBe(60_000);
    expect(summary.status).toBe('PARTIAL');
  });

  /**
   * বেশি টাকা এলে due ঋণাত্মক হবে না — ০-তে থামবে।
   * ঋণাত্মক due দেখালে UI-তে "বাকি -৫০০ টাকা" লেখা উঠত।
   */
  it('never reports a negative due', () => {
    const summary = summarizePayments(TOTAL, [received(TOTAL + 20_000)]);

    expect(summary.duePaisa).toBe(0);
    expect(summary.status).toBe('PAID');
  });

  it('calls it REFUNDED once the money has gone back and nothing is held', () => {
    const summary = summarizePayments(TOTAL, [refunded(TOTAL)]);

    expect(summary.paidPaisa).toBe(0);
    expect(summary.status).toBe('REFUNDED');
  });

  /**
   * আংশিক ফেরতের পরেও টাকা ধরে রাখা থাকলে সেটা REFUNDED নয় —
   * অর্ডারটা এখনো আংশিক পরিশোধিত, আর বাকিটা আদায় করতে হবে।
   */
  it('stays PARTIAL when a refund leaves money still held', () => {
    const summary = summarizePayments(TOTAL, [received(60_000), refunded(40_000)]);

    expect(summary.paidPaisa).toBe(60_000);
    expect(summary.duePaisa).toBe(40_000);
    expect(summary.status).toBe('PARTIAL');
  });

  /** পয়সা পূর্ণসংখ্যাতেই থাকে — float-এর ০.১+০.২ সমস্যা ঢোকে না। */
  it('keeps every figure an integer', () => {
    const summary = summarizePayments(33_333, [received(11_111)]);

    expect(Number.isInteger(summary.paidPaisa)).toBe(true);
    expect(Number.isInteger(summary.duePaisa)).toBe(true);
    expect(summary.duePaisa).toBe(22_222);
  });
});
