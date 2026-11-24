import {
  findZoneForDistrict,
  normalizeDistrict,
  quoteShipping,
  type ShippingZoneLike,
} from '@shop/shared';

/**
 * শিপিং চার্জের নিয়ম — DB ছাড়াই যাচাই করা যায়।
 *
 * **কেন এত টেস্ট:** এর আগে চার্জ হার্ডকোড `0` ছিল, অর্থাৎ প্রতিটা
 * ডেলিভারি ফ্রি — প্রতি অর্ডারে সরাসরি লোকসান। এখানে ভুল থাকলে
 * সেই লোকসান ফিরে আসবে, আর সেটা চোখে পড়বে না কারণ অর্ডার তো
 * সফলই হচ্ছে।
 */

const dhaka: ShippingZoneLike = {
  id: 'zone-dhaka',
  name: 'ঢাকা সিটি',
  districts: ['Dhaka'],
  chargePaisa: 6_000, // ৬০ টাকা
  freeAbovePaisa: 100_000, // ১০০০ টাকার উপরে ফ্রি
  isDefault: false,
};

const outside: ShippingZoneLike = {
  id: 'zone-outside',
  name: 'ঢাকার বাইরে',
  districts: [],
  chargePaisa: 12_000,
  freeAbovePaisa: null, // বাইরে কখনো ফ্রি নয়
  isDefault: true,
};

const zones = [dhaka, outside];

describe('matching a district to a zone', () => {
  it('finds the zone a district belongs to', () => {
    expect(findZoneForDistrict(zones, 'Dhaka')?.id).toBe('zone-dhaka');
  });

  /**
   * জেলা free text, তাই ক্রেতা যা খুশি লিখতে পারে। ছোট-বড় হাতের
   * পার্থক্যে zone না মিললে ঢাকার ক্রেতা বাইরের চার্জ দিত।
   */
  it('ignores case and stray spaces', () => {
    expect(findZoneForDistrict(zones, 'dhaka')?.id).toBe('zone-dhaka');
    expect(findZoneForDistrict(zones, '  DHAKA  ')?.id).toBe('zone-dhaka');
  });

  /** নতুন জেলা এলে default — নইলে চার্জ ০ হয়ে যেত। */
  it('falls back to the default zone for an unknown district', () => {
    expect(findZoneForDistrict(zones, 'Bandarban')?.id).toBe('zone-outside');
  });

  /**
   * **সবচেয়ে বিপজ্জনক ক্ষেত্র।** default zone না থাকলে কী হয় সেটা
   * স্পষ্ট হওয়া দরকার — চুপচাপ ০ চার্জ নয়, বরং `null`, যাতে
   * ডাকা কোড সিদ্ধান্ত নিতে বাধ্য হয়।
   */
  it('returns null when nothing matches and there is no default', () => {
    const noDefault = [{ ...dhaka }];

    expect(findZoneForDistrict(noDefault, 'Sylhet')).toBeNull();
  });

  it('normalizes a district the same way every time', () => {
    expect(normalizeDistrict(' Cox\'s Bazar ')).toBe("cox's bazar");
  });
});

describe('quoting the charge', () => {
  it('charges the zone rate for a small order', () => {
    const quote = quoteShipping(dhaka, 50_000);

    expect(quote.chargePaisa).toBe(6_000);
    expect(quote.isFree).toBe(false);
  });

  it('gives free delivery once the threshold is reached', () => {
    const quote = quoteShipping(dhaka, 100_000);

    expect(quote.chargePaisa).toBe(0);
    expect(quote.isFree).toBe(true);
  });

  /** সীমানায় ভুল হওয়া সবচেয়ে সহজ — ঠিক সীমায় ফ্রি হওয়া উচিত। */
  it('treats the threshold as inclusive', () => {
    expect(quoteShipping(dhaka, 99_999).isFree).toBe(false);
    expect(quoteShipping(dhaka, 100_000).isFree).toBe(true);
  });

  it('never gives free delivery where the zone does not allow it', () => {
    const quote = quoteShipping(outside, 1_000_000);

    expect(quote.chargePaisa).toBe(12_000);
    expect(quote.isFree).toBe(false);
    expect(quote.freeAfterPaisa).toBeNull();
  });

  /** "আর ২০০ টাকার কিনলে ফ্রি" — বিক্রি বাড়ানোর সহজ উপায়। */
  it('says how much more would earn free delivery', () => {
    const quote = quoteShipping(dhaka, 80_000);

    expect(quote.freeAfterPaisa).toBe(20_000);
  });

  it('stops nudging once delivery is already free', () => {
    expect(quoteShipping(dhaka, 150_000).freeAfterPaisa).toBeNull();
  });

  it('carries the zone name so the cart can show it', () => {
    expect(quoteShipping(dhaka, 10_000).zoneName).toBe('ঢাকা সিটি');
  });
});
