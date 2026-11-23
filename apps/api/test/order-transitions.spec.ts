import {
  canTransition,
  isCancellable,
  isTerminalStatus,
  nextStatuses,
  ORDER_STATUSES,
  type OrderStatus,
} from '@shop/shared';

/**
 * Status-এর নিয়ম — pure ফাংশন, DB ছাড়াই টেস্ট।
 *
 * এই নিয়ম ভাঙলে ডেলিভারি হওয়া অর্ডার আবার PENDING হয়ে যেত,
 * আর হিসাব মেলানো অসম্ভব হতো।
 */
describe('order status transitions', () => {
  it('walks the happy path from start to delivered', () => {
    const path: OrderStatus[] = [
      'PENDING',
      'DESIGN_CONFIRMED',
      'IN_PRODUCTION',
      'PRINTED',
      'SHIPPED',
      'DELIVERED',
    ];

    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index];
      const to = path[index + 1];

      // টাইপ সংকুচিত করা — noUncheckedIndexedAccess
      if (from === undefined || to === undefined) {
        throw new Error('path is malformed');
      }

      expect(canTransition(from, to)).toBe(true);
    }
  });

  /** ডেলিভারি হওয়া অর্ডার আর কোথাও যায় না। */
  it('never goes backwards', () => {
    expect(canTransition('DELIVERED', 'SHIPPED')).toBe(false);
    expect(canTransition('DELIVERED', 'PENDING')).toBe(false);
    expect(canTransition('SHIPPED', 'PRINTED')).toBe(false);
    expect(canTransition('IN_PRODUCTION', 'PENDING')).toBe(false);
  });

  it('does not let a status skip a step', () => {
    expect(canTransition('PENDING', 'SHIPPED')).toBe(false);
    expect(canTransition('PENDING', 'DELIVERED')).toBe(false);
    expect(canTransition('DESIGN_CONFIRMED', 'PRINTED')).toBe(false);
  });

  it('refuses to move a status to itself', () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  describe('cancelling', () => {
    /** ছাপার আগে পর্যন্ত বাতিল চলে — কাপড় তখনো নষ্ট হয়নি। */
    it('is allowed before the design is printed', () => {
      expect(isCancellable('PENDING')).toBe(true);
      expect(isCancellable('DESIGN_CONFIRMED')).toBe(true);
      expect(isCancellable('IN_PRODUCTION')).toBe(true);
    });

    /**
     * ছাপা হয়ে গেলে বাতিল নয় — কাপড় আর কাজ দুটোই খরচ হয়ে গেছে।
     * টাকা ফেরতের সিদ্ধান্ত আলাদা, পেমেন্টের দিকে।
     */
    it('is refused once printed or later', () => {
      expect(isCancellable('PRINTED')).toBe(false);
      expect(isCancellable('SHIPPED')).toBe(false);
      expect(isCancellable('DELIVERED')).toBe(false);
    });
  });

  describe('terminal statuses', () => {
    it('marks delivered and cancelled as the end of the road', () => {
      expect(isTerminalStatus('DELIVERED')).toBe(true);
      expect(isTerminalStatus('CANCELLED')).toBe(true);
    });

    it('leaves every other status with somewhere to go', () => {
      const open: readonly OrderStatus[] = ORDER_STATUSES.filter(
        (status: OrderStatus) => status !== 'DELIVERED' && status !== 'CANCELLED',
      );

      for (const status of open) {
        expect(nextStatuses(status).length).toBeGreaterThan(0);
      }
    });
  });

  /**
   * প্রতিটা status-এর নিয়ম লেখা আছে কিনা। নতুন status যোগ করে
   * transition map-এ লিখতে ভুলে গেলে এই টেস্ট ধরে ফেলবে।
   */
  it('has a rule for every status', () => {
    for (const status of ORDER_STATUSES) {
      expect(nextStatuses(status)).toBeDefined();
    }
  });
});
