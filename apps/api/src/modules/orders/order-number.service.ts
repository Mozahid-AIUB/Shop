import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatOrderNumber, orderDateKey } from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * অর্ডার নম্বর — `ORD-2026-1123-018`, প্রতিদিন ০০১ থেকে শুরু।
 *
 * কেন কাউন্টার টেবিল, `COUNT(*) + 1` নয়:
 * দুটো চেকআউট একসাথে এলে দুটোই একই count পড়ত আর একই নম্বর পেত।
 * এখানে row-টা `FOR UPDATE` দিয়ে লক করা হয়, তাই দ্বিতীয় transaction
 * প্রথমটার commit-এর জন্য অপেক্ষা করে — নম্বর কখনো পুনরাবৃত্ত হয় না।
 */
@Injectable()
export class OrderNumberService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * **অবশ্যই** চেকআউটের transaction-এর ভেতরে ডাকতে হবে।
   * বাইরে ডাকলে লক সঙ্গে সঙ্গে ছেড়ে যাবে আর নম্বর ফাঁকা পড়ে থাকতে পারে
   * (অর্ডার তৈরি ব্যর্থ হলে)।
   */
  async next(tx: Prisma.TransactionClient, now: Date = new Date()): Promise<string> {
    const dateKey = orderDateKey(now);

    /**
     * এক query-তে: row না থাকলে তৈরি করো, থাকলে বাড়াও।
     * `ON CONFLICT` ব্যবহার করায় প্রথম অর্ডারের দৌড়েও (দুজন একসাথে
     * দিনের প্রথম অর্ডার দিলে) কেউ ব্যর্থ হয় না।
     *
     * `RETURNING` লক ধরে রাখা অবস্থাতেই নতুন মানটা ফেরত দেয়,
     * তাই আলাদা করে আবার পড়ার দরকার নেই।
     */
    const rows = await tx.$queryRaw<{ lastSerial: number }[]>`
      INSERT INTO order_counters ("dateKey", "lastSerial")
      VALUES (${dateKey}, 1)
      ON CONFLICT ("dateKey")
      DO UPDATE SET "lastSerial" = order_counters."lastSerial" + 1
      RETURNING "lastSerial"
    `;

    const serial = rows[0]?.lastSerial;

    if (serial === undefined) {
      throw new Error('Order counter did not return a serial');
    }

    return formatOrderNumber(now, serial);
  }
}
