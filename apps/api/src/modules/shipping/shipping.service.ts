import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  findZoneForDistrict,
  quoteShipping,
  type ShippingQuote,
  type ShippingZoneInput,
  type ShippingZoneUpdate,
} from '@shop/shared';
import type { ShippingZone } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ডেলিভারি চার্জ।
 *
 * এর আগে `orders.service.ts`-এ চার্জ হার্ডকোড `0` ছিল — অর্থাৎ
 * প্রতিটা ডেলিভারি ফ্রি, প্রতি অর্ডারে লোকসান। এখন নিয়ম DB-তে।
 *
 * হিসাবের যুক্তি `packages/shared`-এ, কারণ কার্টের পাতাতেও একই
 * অঙ্ক দেখাতে হবে। দুই জায়গায় দুই নিয়ম থাকলে কার্টে এক আর
 * অর্ডারে আরেক চার্জ দেখাতো।
 */
@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * জেলা ও subtotal থেকে চার্জ।
   *
   * `subtotalPaisa` **ছাড়ের আগের** অঙ্ক হতে হবে — কুপনের ছাড় বাদ
   * দিয়ে গুনলে ক্রেতা ছাড় নিয়ে ফ্রি ডেলিভারির সীমার নিচে নেমে
   * যেত আর হঠাৎ চার্জ ফিরে আসত।
   */
  async quote(district: string, subtotalPaisa: number): Promise<ShippingQuote> {
    const zones = await this.prisma.shippingZone.findMany({
      where: { isActive: true },
      /**
       * `sortOrder` সমান হলে ক্রম অনির্দিষ্ট থেকে যায়, আর
       * `findZoneForDistrict` **প্রথম মিলটাই** নেয় — তাই একই
       * জেলা দুই zone-এ থাকলে উত্তর বদলে বদলে আসত। `createdAt`
       * দ্বিতীয় শর্ত হিসেবে ক্রমটা স্থির করে: আগে তৈরি zone আগে।
       */
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        districts: true,
        chargePaisa: true,
        freeAbovePaisa: true,
        isDefault: true,
      },
    });

    const zone = findZoneForDistrict(zones, district);

    /**
     * **চুপচাপ ০ চার্জ করা হয় না।**
     *
     * zone না পাওয়া মানে কনফিগারেশন অসম্পূর্ণ (কেউ default zone
     * মুছে ফেলেছে)। তখন ০ ধরে নিলে প্রতিটা অর্ডারে লোকসান হতো আর
     * কেউ টেরও পেত না — অর্ডার তো সফলই হচ্ছে। তাই জোরে ভাঙা হয়,
     * যাতে সমস্যাটা সাথে সাথে চোখে পড়ে।
     */
    if (zone === null) {
      this.logger.error(
        `No shipping zone matched "${district}" and no default zone exists — ` +
          'add one in admin, otherwise every delivery is free',
      );

      throw new InternalServerErrorException(
        'ডেলিভারি চার্জের এলাকা সেট করা নেই — অ্যাডমিনকে জানান',
      );
    }

    return quoteShipping(zone, subtotalPaisa);
  }

  // ---------- অ্যাডমিন ----------

  /** সব zone, নিষ্ক্রিয়গুলোসহ — অ্যাডমিন সব দেখবে। */
  listAll(): Promise<ShippingZone[]> {
    return this.prisma.shippingZone.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async create(input: ShippingZoneInput): Promise<ShippingZone> {
    return this.prisma.$transaction(async (tx) => {
      // default একটাই থাকবে — নতুনটা default হলে পুরোনোটা নামিয়ে দাও
      if (input.isDefault) {
        await tx.shippingZone.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.shippingZone.create({ data: input });
    });
  }

  async update(id: string, input: ShippingZoneUpdate): Promise<ShippingZone> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.shippingZone.findUnique({ where: { id } });

      if (existing === null) {
        throw new NotFoundException('এই এলাকাটা নেই');
      }

      if (input.isDefault === true) {
        await tx.shippingZone.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      /**
       * শেষ default zone-কে default থেকে নামানো যাবে না।
       *
       * নামালে অচেনা জেলার ক্রেতার checkout ভেঙে পড়ত — আর সেটা
       * ধরা পড়ত কেবল আসল ক্রেতা চেষ্টা করার সময়, বিক্রি হারানোর পর।
       */
      if (existing.isDefault && input.isDefault === false) {
        throw new BadRequestException(
          'অন্তত একটা এলাকা default থাকতে হবে — আগে অন্যটাকে default করুন',
        );
      }

      return tx.shippingZone.update({ where: { id }, data: input });
    });
  }

  /** default zone মোছা যায় না — একই কারণ। */
  async remove(id: string): Promise<void> {
    const zone = await this.prisma.shippingZone.findUnique({ where: { id } });

    if (zone === null) {
      throw new NotFoundException('এই এলাকাটা নেই');
    }

    if (zone.isDefault) {
      throw new BadRequestException(
        'default এলাকা মোছা যাবে না — আগে অন্যটাকে default করুন',
      );
    }

    await this.prisma.shippingZone.delete({ where: { id } });
  }
}
