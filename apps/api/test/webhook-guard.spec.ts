import { createHmac } from 'node:crypto';
import {
  headerValue,
  hmacMatches,
  mapStatus,
  secretMatches,
} from '../src/modules/courier/webhook-guard';

/**
 * webhook যাচাই।
 *
 * **কেন এটা ইউনিট টেস্টে:** এই চারটা ফাংশনই কুরিয়ারের webhook-এর
 * একমাত্র রক্ষা। ভুয়া webhook ঢুকলে যে কেউ "DELIVERED" পাঠিয়ে
 * অর্ডার ডেলিভারড দেখাত, আর COD-র টাকা না পেয়েই হিসাব মিলে যেত।
 *
 * e2e-তে পুরো পথ পরীক্ষা করা যায়, কিন্তু **সীমানার ঘটনাগুলো**
 * (খালি signature, ভুল দৈর্ঘ্য, অজানা অবস্থা) এখানে সস্তায় আর
 * নিখুঁতভাবে পরীক্ষা করা যায়।
 */
describe('webhook guard', () => {
  describe('secretMatches', () => {
    it('accepts the right secret', () => {
      expect(secretMatches('abc123', 'abc123')).toBe(true);
    });

    it('rejects a wrong secret', () => {
      expect(secretMatches('abc124', 'abc123')).toBe(false);
    });

    /** header না থাকলে — সবচেয়ে সাধারণ ভুয়া webhook। */
    it('rejects a missing secret', () => {
      expect(secretMatches(undefined, 'abc123')).toBe(false);
    });

    /**
     * দৈর্ঘ্য আলাদা হলে `false`, crash নয়।
     *
     * `timingSafeEqual` আলাদা দৈর্ঘ্যে throw করে, আর সেটা ৫০০
     * হয়ে যেত — তখন কুরিয়ার বারবার retry করত।
     */
    it('rejects a secret of a different length without throwing', () => {
      expect(secretMatches('short', 'much-longer-secret')).toBe(false);
      expect(secretMatches('much-longer-secret', 'short')).toBe(false);
    });

    it('rejects an empty secret against a real one', () => {
      expect(secretMatches('', 'abc123')).toBe(false);
    });
  });

  describe('hmacMatches', () => {
    const secret = 'shared-secret';
    const body = '{"consignment_id":"CN-1","status":"delivered"}';
    const signature = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

    it('accepts a signature made with the same secret', () => {
      expect(hmacMatches(body, signature, secret)).toBe(true);
    });

    /** কুরিয়াররা কেউ বড় হাতে পাঠায়, কেউ ছোট হাতে। */
    it('accepts an upper-case signature', () => {
      expect(hmacMatches(body, signature.toUpperCase(), secret)).toBe(true);
    });

    it('rejects a signature made with another secret', () => {
      const other = createHmac('sha256', 'other-secret').update(body, 'utf8').digest('hex');

      expect(hmacMatches(body, other, secret)).toBe(false);
    });

    /**
     * **body বদলালে signature মেলে না** — এটাই HMAC-এর আসল কাজ।
     *
     * না মিললে বোঝা যায় পথে কেউ "pending" বদলে "delivered" করেছে।
     */
    it('rejects a tampered body', () => {
      const tampered = body.replace('delivered', 'pending');

      expect(hmacMatches(tampered, signature, secret)).toBe(false);
    });

    it('rejects a missing signature', () => {
      expect(hmacMatches(body, undefined, secret)).toBe(false);
    });
  });

  describe('headerValue', () => {
    it('reads a header case-insensitively', () => {
      expect(headerValue({ 'x-token': 'abc' }, 'X-Token')).toBe('abc');
    });

    /** একই header দুবার এলে প্রথমটা — node এগুলো array-তে দেয়। */
    it('takes the first value when a header repeats', () => {
      expect(headerValue({ 'x-token': ['first', 'second'] }, 'x-token')).toBe('first');
    });

    it('returns undefined for a header that is not there', () => {
      expect(headerValue({}, 'x-token')).toBeUndefined();
    });
  });

  describe('mapStatus', () => {
    const table = { delivered: 'DELIVERED', 'in transit': 'IN_TRANSIT' } as const;

    it('maps a known status', () => {
      expect(mapStatus('delivered', table)).toBe('DELIVERED');
    });

    /** কুরিয়ারের বানান ধরে নেওয়া যায় না — বড়/ছোট হাত, ফাঁকা জায়গা। */
    it('ignores case and surrounding spaces', () => {
      expect(mapStatus('  Delivered ', table)).toBe('DELIVERED');
    });

    /**
     * **অজানা অবস্থায় `null`** — অনুমান করা হয় না।
     *
     * অনুমান করে `DELIVERED` ধরে নিলে টাকা না পেয়েই অর্ডার
     * সম্পন্ন দেখাত। `null` হলে পার্সেল যেমন ছিল তেমনই থাকে।
     */
    it('returns null for a status it does not know', () => {
      expect(mapStatus('teleported', table)).toBeNull();
    });

    it('returns null when the courier sent no status', () => {
      expect(mapStatus(undefined, table)).toBeNull();
    });
  });
});
