import {
  COUPON_FAILURE,
  type CouponLike,
  computeDiscount,
  evaluateCoupon,
  normalizeCouponCode,
} from '@shop/shared';

/**
 * কুপনের হিসাব — বিশুদ্ধ ফাংশন, DB ছাড়া।
 *
 * **এখানে ভুলের দাম সরাসরি টাকায়।** ছাড় মোটের চেয়ে বেশি হলে
 * total ঋণাত্মক হয়ে যেত, আর শর্ত যাচাই ঢিলে হলে মেয়াদ শেষ হওয়া
 * কুপনও চলত। তাই নিয়মগুলো আলাদা করে, DB ছাড়াই পরীক্ষা করা হয় —
 * যেন প্রতিটা সীমা স্পষ্টভাবে লেখা থাকে।
 */

const baseCoupon = (overrides: Partial<CouponLike> = {}): CouponLike => ({
  id: 'coupon-1',
  code: 'SAVE50',
  type: 'FIXED',
  value: 5_000,
  maxDiscountPaisa: null,
  minOrderPaisa: 0,
  startsAt: null,
  endsAt: null,
  maxUses: null,
  maxUsesPerUser: 1,
  isActive: true,
  ...overrides,
});

/** যাচাইয়ের সময়ের হিসাব সবসময় একই দিনে — টেস্ট যেন সময়ের সাথে না ভাঙে। */
const now = new Date('2026-06-15T10:00:00.000Z');

describe('computeDiscount', () => {
  describe('FIXED', () => {
    it('takes the flat amount off', () => {
      const result = computeDiscount(baseCoupon({ type: 'FIXED', value: 5_000 }), {
        subtotalPaisa: 50_000,
        shippingPaisa: 6_000,
      });

      expect(result.discountPaisa).toBe(5_000);
      expect(result.shippingDiscountPaisa).toBe(0);
    });

    /**
     * **সবচেয়ে দামি বাগটা এখানেই লুকোনো।** ছাড় মোটের চেয়ে বড় হলে
     * total ঋণাত্মক হতো — মানে দোকান ক্রেতাকে টাকা ফেরত দিচ্ছে।
     */
    it('never gives more discount than the subtotal', () => {
      const result = computeDiscount(baseCoupon({ type: 'FIXED', value: 100_000 }), {
        subtotalPaisa: 30_000,
        shippingPaisa: 6_000,
      });

      expect(result.discountPaisa).toBe(30_000);
    });

    it('leaves a total that is never negative', () => {
      const subtotalPaisa = 30_000;
      const shippingPaisa = 6_000;

      const result = computeDiscount(baseCoupon({ type: 'FIXED', value: 999_999 }), {
        subtotalPaisa,
        shippingPaisa,
      });

      const total =
        subtotalPaisa + shippingPaisa - result.discountPaisa - result.shippingDiscountPaisa;

      expect(total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('PERCENT', () => {
    it('takes the percentage off', () => {
      const result = computeDiscount(baseCoupon({ type: 'PERCENT', value: 10 }), {
        subtotalPaisa: 50_000,
        shippingPaisa: 6_000,
      });

      expect(result.discountPaisa).toBe(5_000);
    });

    /** "১০% কিন্তু সর্বোচ্চ ২০০ টাকা" — বড় অর্ডারে লোকসান আটকায়। */
    it('respects the cap the admin set', () => {
      const result = computeDiscount(
        baseCoupon({ type: 'PERCENT', value: 10, maxDiscountPaisa: 20_000 }),
        { subtotalPaisa: 500_000, shippingPaisa: 6_000 },
      );

      expect(result.discountPaisa).toBe(20_000);
    });

    /**
     * শতাংশে ভাঙা পয়সা আসে। **নিচের দিকে** নেওয়া হয় — উপরে নিলে
     * ছাড় সামান্য বেশি হয়ে অঙ্ক মিলত না, আর বহু অর্ডারে জমে যেত।
     */
    it('rounds a fractional paisa down', () => {
      const result = computeDiscount(baseCoupon({ type: 'PERCENT', value: 10 }), {
        subtotalPaisa: 19_999,
        shippingPaisa: 0,
      });

      // ১০% = ১৯৯৯.৯ পয়সা
      expect(result.discountPaisa).toBe(1_999);
      expect(Number.isInteger(result.discountPaisa)).toBe(true);
    });

    it('never exceeds the subtotal even at 100 percent', () => {
      const result = computeDiscount(baseCoupon({ type: 'PERCENT', value: 100 }), {
        subtotalPaisa: 40_000,
        shippingPaisa: 6_000,
      });

      expect(result.discountPaisa).toBe(40_000);
      // ১০০% ছাড় মানেও ডেলিভারি চার্জ মাফ নয়
      expect(result.shippingDiscountPaisa).toBe(0);
    });
  });

  describe('FREE_SHIPPING', () => {
    /**
     * ফ্রি শিপিং **আলাদা মাঠে** রাখা হয়, `discountPaisa`-তে মেশানো হয় না।
     * মিশিয়ে দিলে ইনভয়েসে "ডেলিভারি ৬০৳" আর "ছাড় ৬০৳" দুটোই দেখাত —
     * ক্রেতা বিভ্রান্ত হতো, আর কুরিয়ারের হিসাব মেলানো কঠিন হতো।
     */
    it('waives the delivery charge, not the goods', () => {
      const result = computeDiscount(baseCoupon({ type: 'FREE_SHIPPING', value: 0 }), {
        subtotalPaisa: 50_000,
        shippingPaisa: 6_000,
      });

      expect(result.discountPaisa).toBe(0);
      expect(result.shippingDiscountPaisa).toBe(6_000);
    });

    /** ডেলিভারি আগেই ফ্রি হলে কুপন বাড়তি কিছু দেয় না — ঋণাত্মকও নয়। */
    it('gives nothing extra when delivery is already free', () => {
      const result = computeDiscount(baseCoupon({ type: 'FREE_SHIPPING', value: 0 }), {
        subtotalPaisa: 200_000,
        shippingPaisa: 0,
      });

      expect(result.shippingDiscountPaisa).toBe(0);
    });
  });
});

describe('evaluateCoupon', () => {
  const context = { subtotalPaisa: 50_000, now, totalUses: 0, userUses: 0 };

  it('accepts a coupon that meets every condition', () => {
    const result = evaluateCoupon(baseCoupon(), context);

    expect(result.ok).toBe(true);
  });

  it('refuses a coupon the admin switched off', () => {
    const result = evaluateCoupon(baseCoupon({ isActive: false }), context);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe(COUPON_FAILURE.INACTIVE);
  });

  describe('the dates', () => {
    it('refuses one that has not started', () => {
      const result = evaluateCoupon(
        baseCoupon({ startsAt: new Date('2026-07-01T00:00:00.000Z') }),
        context,
      );

      expect(result.ok === false && result.reason).toBe(COUPON_FAILURE.NOT_STARTED);
    });

    it('refuses one that has expired', () => {
      const result = evaluateCoupon(
        baseCoupon({ endsAt: new Date('2026-06-01T00:00:00.000Z') }),
        context,
      );

      expect(result.ok === false && result.reason).toBe(COUPON_FAILURE.EXPIRED);
    });

    /** সীমানার ঠিক মুহূর্তে চলবে — "শেষ দিন" ক্রেতার কাছে শেষ দিনই। */
    it('still works at the very moment it ends', () => {
      const result = evaluateCoupon(baseCoupon({ endsAt: now }), context);

      expect(result.ok).toBe(true);
    });

    it('works at the very moment it starts', () => {
      const result = evaluateCoupon(baseCoupon({ startsAt: now }), context);

      expect(result.ok).toBe(true);
    });
  });

  describe('the minimum order', () => {
    it('refuses an order below the minimum', () => {
      const result = evaluateCoupon(baseCoupon({ minOrderPaisa: 100_000 }), context);

      expect(result.ok === false && result.reason).toBe(COUPON_FAILURE.BELOW_MINIMUM);
    });

    /** ন্যূনতম **ছুঁয়ে** ফেললেই চলবে — "১০০০ টাকার উপরে" মানে ১০০০ সহ। */
    it('accepts an order exactly at the minimum', () => {
      const result = evaluateCoupon(baseCoupon({ minOrderPaisa: 50_000 }), context);

      expect(result.ok).toBe(true);
    });

    /** কত টাকা কম পড়ল — কার্টে দেখানোর জন্য দরকার। */
    it('says how much more the customer needs', () => {
      const result = evaluateCoupon(baseCoupon({ minOrderPaisa: 80_000 }), context);

      expect(result.ok === false && result.shortfallPaisa).toBe(30_000);
    });
  });

  describe('the use limits', () => {
    it('refuses once the overall limit is reached', () => {
      const result = evaluateCoupon(baseCoupon({ maxUses: 100 }), {
        ...context,
        totalUses: 100,
      });

      expect(result.ok === false && result.reason).toBe(COUPON_FAILURE.EXHAUSTED);
    });

    it('allows the last remaining use', () => {
      const result = evaluateCoupon(baseCoupon({ maxUses: 100 }), {
        ...context,
        totalUses: 99,
      });

      expect(result.ok).toBe(true);
    });

    it('refuses a customer who already used their allowance', () => {
      const result = evaluateCoupon(baseCoupon({ maxUsesPerUser: 1 }), {
        ...context,
        userUses: 1,
      });

      expect(result.ok === false && result.reason).toBe(COUPON_FAILURE.ALREADY_USED);
    });

    it('lets a customer use a multi-use coupon again', () => {
      const result = evaluateCoupon(baseCoupon({ maxUsesPerUser: 3 }), {
        ...context,
        userUses: 2,
      });

      expect(result.ok).toBe(true);
    });

    /** `maxUses: null` মানে সীমা নেই — অসংখ্য ব্যবহারেও চলবে। */
    it('treats a null overall limit as unlimited', () => {
      const result = evaluateCoupon(baseCoupon({ maxUses: null }), {
        ...context,
        totalUses: 10_000,
      });

      expect(result.ok).toBe(true);
    });
  });

  /**
   * একটা কুপনে একাধিক শর্ত ভাঙলে **প্রথম কারণটাই** বলা হয়, কারণ
   * ক্রেতাকে একবারে একটা কাজ বলা উচিত।
   */
  it('reports a single reason when several conditions fail', () => {
    const result = evaluateCoupon(baseCoupon({ isActive: false, minOrderPaisa: 999_999 }), context);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe(COUPON_FAILURE.INACTIVE);
  });
});

describe('normalizeCouponCode', () => {
  /**
   * ক্রেতা হাতে টাইপ করে, কপি-পেস্টে ফাঁকা জায়গা আসে। কোড
   * স্বাভাবিক না করলে "save50" আর " SAVE50 " আলাদা কুপন হতো আর
   * ক্রেতা বলত "কোড কাজ করছে না"।
   */
  it('accepts the code however the customer typed it', () => {
    expect(normalizeCouponCode(' save50 ')).toBe('SAVE50');
    expect(normalizeCouponCode('Save50')).toBe('SAVE50');
    expect(normalizeCouponCode('SAVE50')).toBe('SAVE50');
  });
});
