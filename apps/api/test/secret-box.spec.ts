import { SecretBox } from '../src/common/secret-box';

/**
 * কুরিয়ারের API key এনক্রিপশন।
 *
 * **কেন এটা দরকার:** key কুরিয়ার কোম্পানির সাথে করা ব্যবসার নিজের
 * অ্যাকাউন্টে বাঁধা। key হাতে পেলে যে কেউ ওই অ্যাকাউন্ট দিয়ে
 * পার্সেল পাঠাতে পারে, আর COD-র টাকার হিসাবও ঘেঁটে দিতে পারে।
 *
 * DB backup, `pg_dump`, বা DB-র read access — তিনটাই সাধারণ ঘটনা।
 * তাই key DB-তে সাধারণভাবে রাখা চলবে না।
 */
describe('SecretBox', () => {
  /** ৩২ বাইট = ২৫৬ বিট, AES-256-এর চাবি। */
  const key = 'a'.repeat(64);
  const box = new SecretBox(key);

  it('returns the original text after a round trip', () => {
    const plain = 'steadfast-api-key-12345';

    expect(box.open(box.seal(plain))).toBe(plain);
  });

  /**
   * একই লেখা দুবার এনক্রিপ্ট করলে **আলাদা ciphertext** আসতে হবে।
   *
   * একই আসলে দেখেই বোঝা যেত দুটো দোকান একই key ব্যবহার করছে, আর
   * key বদলেছে কিনা তাও ciphertext মিলিয়ে ধরা যেত। প্রতিবার নতুন
   * random IV সেটা ঠেকায়।
   */
  it('produces different ciphertext each time', () => {
    const plain = 'same-secret';

    expect(box.seal(plain)).not.toBe(box.seal(plain));
  });

  /**
   * **সবচেয়ে দরকারি টেস্ট।** ciphertext-এ কেউ হাত দিলে decrypt
   * ব্যর্থ হতে হবে — চুপচাপ ভুল মান ফেরালে আমরা ভুল key দিয়ে
   * কুরিয়ারে call করতাম আর কারণটা কোথাও দেখা যেত না।
   *
   * GCM-এর auth tag এটাই নিশ্চিত করে।
   */
  it('refuses tampered ciphertext', () => {
    const sealed = box.seal('original-key');
    const parts = sealed.split(':');
    const payload = Buffer.from(parts[2] ?? '', 'base64');

    payload[0] = (payload[0] ?? 0) ^ 0xff;

    const tampered = [parts[0], parts[1], payload.toString('base64')].join(':');

    expect(() => box.open(tampered)).toThrow();
  });

  /** ভুল চাবিতে খোলা যাবে না — নইলে এনক্রিপশনের মানেই থাকত না। */
  it('refuses a different key', () => {
    const sealed = box.seal('secret');
    const other = new SecretBox('b'.repeat(64));

    expect(() => other.open(sealed)).toThrow();
  });

  /**
   * খালি লেখাও চলবে — কুরিয়ারের কিছু মাঠ ঐচ্ছিক (যেমন Pathao-র
   * store id নেই এমন সেটআপ), আর সেখানে `''` জমা হতে পারে।
   */
  it('handles an empty string', () => {
    expect(box.open(box.seal(''))).toBe('');
  });

  /** ইউনিকোড — ব্যবসার নাম বাংলায় হতে পারে। */
  it('handles unicode', () => {
    const plain = 'দোকানের নাম';

    expect(box.open(box.seal(plain))).toBe(plain);
  });

  /**
   * ছোট বা অবৈধ চাবি **শুরুতেই** আটকাতে হবে।
   *
   * না আটকালে অ্যাপ চালু হয়ে যেত, আর কুরিয়ারে পাঠানোর মুহূর্তে
   * ভাঙত — সবচেয়ে খারাপ সময়ে। তার চেয়ে বুট হতে না দেওয়া ভালো।
   */
  it('rejects a key that is not 32 bytes', () => {
    expect(() => new SecretBox('tooshort')).toThrow();
    expect(() => new SecretBox('zz'.repeat(32))).toThrow();
  });

  /** আকার ভুল হলে খোলা যাবে না — এলোমেলো ইনপুটে crash নয়, স্পষ্ট ত্রুটি। */
  it('rejects malformed ciphertext', () => {
    expect(() => box.open('not-sealed-at-all')).toThrow();
    expect(() => box.open('a:b')).toThrow();
    expect(() => box.open('')).toThrow();
  });
});
