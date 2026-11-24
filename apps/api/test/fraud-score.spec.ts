import {
  assessFraud,
  fraudLevelFor,
  FRAUD_HIGH_THRESHOLD,
  FRAUD_MEDIUM_THRESHOLD,
  type FraudSignals,
} from '@shop/shared';

/**
 * ঝুঁকির স্কোর — DB ছাড়াই যাচাই করা যায়।
 *
 * **এই ফাইলের সবচেয়ে গুরুত্বপূর্ণ টেস্ট হলো "ভালো ক্রেতা ফ্ল্যাগ হয় না"।**
 * জালিয়াত ধরতে না পারলে এক অর্ডারের ক্ষতি। কিন্তু আসল ক্রেতাকে
 * সন্দেহ করলে সে চিরতরে চলে যায়, আর সেটা কেউ কখনো টের পায় না।
 */

/** সাধারণ, নিরীহ একটা অর্ডার — প্রতিটা টেস্ট এখান থেকে শুরু করে। */
const plainOrder = (): FraudSignals => ({
  failedOrders: 0,
  successfulOrders: 0,
  recentOrderCount: 1,
  accountAgeDays: 120,
  orderTotalPaisa: 80_000, // ৮০০ টাকা
  largeOrderPaisa: 500_000, // ৫০০০ টাকা
  addressUsedByOthers: false,
});

describe('a normal customer is left alone', () => {
  it('scores zero for an ordinary order', () => {
    const result = assessFraud(plainOrder());

    expect(result.score).toBe(0);
    expect(result.level).toBe('LOW');
    expect(result.reasons).toHaveLength(0);
  });

  /** সব ক্রেতাই একদিন নতুন ছিল — এটা একা সন্দেহের কারণ নয়। */
  it('does not suspect a brand new account placing a small order', () => {
    const result = assessFraud({ ...plainOrder(), accountAgeDays: 0 });

    expect(result.level).toBe('LOW');
  });

  /** পুরোনো অ্যাকাউন্ট থেকে বড় অর্ডার স্বাভাবিক — সেটাই ভালো ক্রেতা। */
  it('does not suspect a large order from an established account', () => {
    const result = assessFraud({
      ...plainOrder(),
      orderTotalPaisa: 1_500_000,
      successfulOrders: 3,
    });

    expect(result.level).toBe('LOW');
  });

  /** একই দিনে দুটো অর্ডার অস্বাভাবিক নয় — ভুলে করা, বা উপহার। */
  it('allows a couple of orders in one day', () => {
    const result = assessFraud({ ...plainOrder(), recentOrderCount: 3 });

    expect(result.level).toBe('LOW');
  });

  /**
   * **সবচেয়ে জরুরি টেস্ট।** বহুদিনের বিশ্বস্ত ক্রেতা একবার অর্ডার
   * বাতিল করলেই যেন চিরকাল সন্দেহভাজন হয়ে না থাকে।
   */
  it('forgives one cancellation from a loyal customer', () => {
    const result = assessFraud({
      ...plainOrder(),
      failedOrders: 1,
      successfulOrders: 5,
    });

    expect(result.level).toBe('LOW');
    // ভালো ইতিহাস স্কোর কমিয়েছে
    expect(result.reasons.some((reason) => reason.code === 'GOOD_HISTORY')).toBe(true);
  });

  it('never goes below zero, however good the history', () => {
    const result = assessFraud({ ...plainOrder(), successfulOrders: 50 });

    expect(result.score).toBe(0);
  });
});

describe('real risk signals', () => {
  /** অতীত আচরণই ভবিষ্যতের সেরা আভাস — তাই এটার ওজন সবচেয়ে বেশি। */
  it('flags a customer who keeps refusing deliveries', () => {
    const result = assessFraud({ ...plainOrder(), failedOrders: 2 });

    expect(result.score).toBeGreaterThanOrEqual(FRAUD_HIGH_THRESHOLD);
    expect(result.level).toBe('HIGH');
  });

  it('caps the penalty so one signal cannot own the whole score', () => {
    const two = assessFraud({ ...plainOrder(), failedOrders: 2 }).score;
    const ten = assessFraud({ ...plainOrder(), failedOrders: 10 }).score;

    expect(ten).toBe(two);
  });

  it('notices many orders from the same phone in a day', () => {
    const result = assessFraud({ ...plainOrder(), recentOrderCount: 6 });

    expect(result.reasons.some((reason) => reason.code === 'RAPID_ORDERS')).toBe(true);
  });

  /** নতুন অ্যাকাউন্ট + বড় COD — সবচেয়ে বেশি ক্ষতি এখানেই হয়। */
  it('notices a new account placing a large COD order', () => {
    const result = assessFraud({
      ...plainOrder(),
      accountAgeDays: 1,
      orderTotalPaisa: 600_000,
    });

    expect(result.reasons.some((reason) => reason.code === 'NEW_ACCOUNT_LARGE_ORDER')).toBe(true);
  });

  it('notices an address already used by another account', () => {
    const result = assessFraud({ ...plainOrder(), addressUsedByOthers: true });

    expect(result.reasons.some((reason) => reason.code === 'SHARED_ADDRESS')).toBe(true);
  });

  it('adds up when several signals appear together', () => {
    const result = assessFraud({
      ...plainOrder(),
      failedOrders: 1,
      recentOrderCount: 5,
      accountAgeDays: 1,
      orderTotalPaisa: 600_000,
      addressUsedByOthers: true,
    });

    expect(result.level).toBe('HIGH');
    expect(result.reasons.length).toBeGreaterThan(3);
  });

  it('never goes above a hundred', () => {
    const result = assessFraud({
      ...plainOrder(),
      failedOrders: 10,
      recentOrderCount: 50,
      accountAgeDays: 0,
      orderTotalPaisa: 10_000_000,
      addressUsedByOthers: true,
    });

    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('every score carries its reasons', () => {
  /**
   * শুধু "৬৫" দেখলে অ্যাডমিন কিছু করতে পারে না। কারণ দেখলে সে
   * জানে ফোনে কী জিজ্ঞেস করতে হবে।
   */
  it('explains itself in words a person can act on', () => {
    const result = assessFraud({ ...plainOrder(), failedOrders: 2 });

    expect(result.reasons[0]?.detail).toContain('2');
    expect(result.reasons[0]?.points).toBeGreaterThan(0);
  });

  it('shows the points each signal contributed', () => {
    const result = assessFraud({
      ...plainOrder(),
      failedOrders: 1,
      addressUsedByOthers: true,
    });

    const total = result.reasons.reduce((sum, reason) => sum + reason.points, 0);

    expect(total).toBe(result.score);
  });
});

describe('levels', () => {
  it('maps scores to the three levels', () => {
    expect(fraudLevelFor(0)).toBe('LOW');
    expect(fraudLevelFor(FRAUD_MEDIUM_THRESHOLD - 1)).toBe('LOW');
    expect(fraudLevelFor(FRAUD_MEDIUM_THRESHOLD)).toBe('MEDIUM');
    expect(fraudLevelFor(FRAUD_HIGH_THRESHOLD - 1)).toBe('MEDIUM');
    expect(fraudLevelFor(FRAUD_HIGH_THRESHOLD)).toBe('HIGH');
    expect(fraudLevelFor(100)).toBe('HIGH');
  });
});
