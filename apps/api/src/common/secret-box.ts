import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * গোপন মান DB-তে রাখার আগে এনক্রিপ্ট করা।
 *
 * **কী এর ভেতরে যায়:** কুরিয়ারের API key/secret। এগুলো কুরিয়ার
 * কোম্পানির সাথে করা **ব্যবসার নিজের অ্যাকাউন্টে** বাঁধা — key হাতে
 * পেলে যে কেউ ওই অ্যাকাউন্ট দিয়ে পার্সেল পাঠাতে পারে, আর COD-র
 * টাকার হিসাবও ঘেঁটে দিতে পারে।
 *
 * **কেন DB-তে সাধারণভাবে রাখা যায় না:** DB backup, `pg_dump`, বা
 * শুধু read access — তিনটাই সাধারণ ঘটনা। এনক্রিপ্ট করা থাকলে
 * এগুলোর কোনোটাতেই key পড়া যায় না।
 *
 * **AES-256-GCM, CBC নয়:** GCM authenticated — কেউ DB-তে
 * ciphertext বদলালে `open()` throw করে। CBC-তে বদলালে চুপচাপ
 * আলতু-ফালতু মান ফিরত, আর আমরা সেটা নিয়ে কুরিয়ারে call করতাম।
 *
 * **মূল চাবি `.env`-এ, DB-তে নয়** — নইলে তালা আর চাবি একই বাক্সে
 * থাকত, আর এনক্রিপশনের কোনো মানেই হতো না।
 */

/** `iv:tag:payload`, তিনটাই base64 — এক কলামে রাখার সহজ আকার। */
const PART_COUNT = 3;

/** GCM-এর আদর্শ IV ১২ বাইট। */
const IV_BYTES = 12;

/** AES-256 — ৩২ বাইট চাবি, hex-এ ৬৪ অক্ষর। */
const KEY_BYTES = 32;

export class SecretBox {
  private readonly key: Buffer;

  /**
   * @param hexKey ৬৪ অক্ষরের hex (৩২ বাইট)
   *
   * ভুল আকারের চাবিতে **তৈরির সময়েই** throw করে, ইচ্ছাকৃতভাবে।
   * না করলে অ্যাপ চালু হয়ে যেত আর কুরিয়ারে পাঠানোর মুহূর্তে ভাঙত —
   * সবচেয়ে খারাপ সময়ে, যখন ক্রেতা অপেক্ষা করছে।
   */
  constructor(hexKey: string) {
    if (!/^[0-9a-fA-F]+$/.test(hexKey)) {
      throw new Error('COURIER_SECRET_KEY must be hex');
    }

    const key = Buffer.from(hexKey, 'hex');

    if (key.length !== KEY_BYTES) {
      throw new Error(`COURIER_SECRET_KEY must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars)`);
    }

    this.key = key;
  }

  /**
   * এনক্রিপ্ট।
   *
   * প্রতিবার **নতুন random IV** — একই লেখা দুবার এনক্রিপ্ট করলে
   * আলাদা ciphertext আসে। একই আসলে দেখেই বোঝা যেত দুটো দোকান একই
   * key ব্যবহার করছে, বা key বদলায়নি।
   */
  seal(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const payload = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

    return [
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      payload.toString('base64'),
    ].join(':');
  }

  /**
   * ডিক্রিপ্ট। চাবি ভুল হলে, বা ciphertext-এ কেউ হাত দিলে **throw করে**।
   *
   * এখানে `null` ফেরানো হয় না ইচ্ছাকৃতভাবে: ডাকার জায়গায় `null`
   * চেক ভুলে গেলে আমরা খালি key নিয়ে কুরিয়ারে call করতাম আর
   * "unauthorized" দেখে ভাবতাম key-টাই ভুল।
   */
  open(sealed: string): string {
    const parts = sealed.split(':');

    if (parts.length !== PART_COUNT) {
      throw new Error('Malformed sealed value');
    }

    const [ivPart, tagPart, payloadPart] = parts as [string, string, string];
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivPart, 'base64'));

    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(payloadPart, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  /**
   * অ্যাডমিনকে দেখানোর জন্য — **পুরো key কখনো ফেরত যায় না**।
   *
   * প্যানেলে key দেখানোর দরকার নেই, শুধু "ঠিকটা বসানো আছে কি না"
   * মেলানোর দরকার। শেষ ৪ অক্ষর তার জন্য যথেষ্ট, আর এতটুকু ফাঁস
   * হলেও কিছু করা যায় না।
   */
  static mask(plain: string): string {
    const tail = plain.slice(-4);

    return plain.length <= 4 ? '••••' : `••••${tail}`;
  }
}
