import { formatOrderNumber, orderDateKey, parseOrderNumber } from '@shop/shared';

/**
 * অর্ডার নম্বরের ফরম্যাট — `ORD-2026-1123-018`।
 *
 * এই helper দুটো DB ছাড়াই চলে, তাই unit test। সিরিয়াল কোথা থেকে আসে
 * (কাউন্টার টেবিল, concurrent লক) সেটা `orders.e2e.spec.ts`-এ যাচাই হয়।
 */
describe('order number format', () => {
  /**
   * চাবি **সার্ভারের লোকাল দিন** ধরে বসে, UTC নয় — ব্যবসা বাংলাদেশে,
   * তাই "আজকের অর্ডার" মানে ঢাকার আজ। তাই টেস্টেও লোকাল তারিখ দিয়ে
   * `Date` বানানো হচ্ছে, UTC স্ট্রিং দিয়ে নয়।
   */
  describe('orderDateKey', () => {
    it('builds a YYYY-MMDD key', () => {
      expect(orderDateKey(new Date(2026, 10, 23, 10, 0))).toBe('2026-1123');
    });

    it('pads single digit months and days', () => {
      expect(orderDateKey(new Date(2026, 0, 5, 10, 0))).toBe('2026-0105');
    });

    it('gives different keys on different days — সিরিয়াল রোজ রিসেট হওয়ার ভিত্তি', () => {
      const lateNight = orderDateKey(new Date(2026, 10, 23, 23, 59));
      const afterMidnight = orderDateKey(new Date(2026, 10, 24, 0, 1));

      expect(lateNight).toBe('2026-1123');
      expect(afterMidnight).toBe('2026-1124');
    });
  });

  describe('formatOrderNumber', () => {
    it('zero pads the serial to three digits', () => {
      const date = new Date(2026, 10, 23, 10, 0);

      expect(formatOrderNumber(date, 1)).toBe('ORD-2026-1123-001');
      expect(formatOrderNumber(date, 18)).toBe('ORD-2026-1123-018');
      expect(formatOrderNumber(date, 999)).toBe('ORD-2026-1123-999');
    });

    /**
     * দিনে ৯৯৯-এর বেশি অর্ডার হলে নম্বর চার অঙ্কে যাবে — কাটা যাবে না।
     * কাটলে দুটো অর্ডার একই নম্বর পেত, আর orderNumber unique হওয়ায়
     * দ্বিতীয় চেকআউট ব্যর্থ হতো।
     */
    it('grows past three digits instead of truncating', () => {
      const date = new Date(2026, 10, 23, 10, 0);

      expect(formatOrderNumber(date, 1000)).toBe('ORD-2026-1123-1000');
    });

    it('rejects a serial that is not a positive integer', () => {
      const date = new Date(2026, 10, 23, 10, 0);

      expect(() => formatOrderNumber(date, 0)).toThrow();
      expect(() => formatOrderNumber(date, -1)).toThrow();
      expect(() => formatOrderNumber(date, 1.5)).toThrow();
    });
  });

  describe('parseOrderNumber', () => {
    /** সাপোর্ট ফোনে নম্বর শুনে অর্ডার খোঁজে — ইনপুট যাচাই করতে হবে। */
    it('reads back what it wrote', () => {
      expect(parseOrderNumber('ORD-2026-1123-018')).toEqual({
        dateKey: '2026-1123',
        serial: 18,
      });
    });

    it('returns null for anything malformed', () => {
      expect(parseOrderNumber('ORD-2026-1123')).toBeNull();
      expect(parseOrderNumber('018')).toBeNull();
      expect(parseOrderNumber('ord-2026-1123-018')).toBeNull();
      expect(parseOrderNumber('')).toBeNull();
    });
  });
});
