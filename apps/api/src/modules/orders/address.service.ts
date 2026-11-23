import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CreateAddressInput, UpdateAddressInput } from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';

const ADDRESS_SELECT = {
  id: true,
  label: true,
  fullName: true,
  phone: true,
  line1: true,
  line2: true,
  city: true,
  district: true,
  postcode: true,
  isDefault: true,
  createdAt: true,
} satisfies Prisma.AddressSelect;

export type AddressView = Prisma.AddressGetPayload<{ select: typeof ADDRESS_SELECT }>;

@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  /** default ঠিকানা আগে — চেকআউটে ওটাই বাছা থাকবে। */
  list(userId: string): Promise<AddressView[]> {
    return this.prisma.address.findMany({
      where: { userId },
      select: ADDRESS_SELECT,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * প্রথম ঠিকানা **সবসময়** default — ইউজার না চাইলেও।
   * নইলে চেকআউটে default না থাকায় কিছুই বাছা থাকত না।
   */
  async create(userId: string, input: CreateAddressInput): Promise<AddressView> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.count({ where: { userId } });
      const shouldBeDefault = existing === 0 || input.isDefault === true;

      if (shouldBeDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }

      return tx.address.create({
        data: {
          userId,
          label: input.label ?? null,
          fullName: input.fullName,
          phone: input.phone,
          line1: input.line1,
          line2: input.line2 ?? null,
          city: input.city,
          district: input.district,
          postcode: input.postcode ?? null,
          isDefault: shouldBeDefault,
        },
        select: ADDRESS_SELECT,
      });
    });
  }

  async update(userId: string, id: string, input: UpdateAddressInput): Promise<AddressView> {
    await this.assertOwn(userId, id);

    return this.prisma.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }

      return tx.address.update({
        where: { id },
        data: {
          ...input,
          label: input.label ?? undefined,
          line2: input.line2 ?? undefined,
          postcode: input.postcode ?? undefined,
        },
        select: ADDRESS_SELECT,
      });
    });
  }

  /**
   * মোছা মানে row মুছে যাওয়া, কিন্তু অর্ডারে ঠিকানার **কপি** থাকায়
   * পুরোনো অর্ডার কোথায় গিয়েছিল তা জানা থাকে (`Order.addressId`
   * SetNull হয়, snapshot ফিল্ডগুলো থেকে যায়)।
   */
  async remove(userId: string, id: string): Promise<{ id: string }> {
    const address = await this.assertOwn(userId, id);

    await this.prisma.address.delete({ where: { id } });

    // default মুছলে আরেকটাকে default বানাও, নইলে চেকআউটে কিছুই বাছা থাকবে না
    if (address.isDefault) {
      const next = await this.prisma.address.findFirst({
        where: { userId },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });

      if (next) {
        await this.prisma.address.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }

    return { id };
  }

  /** "নেই" আর "তোমার নয়" — একই উত্তর, যাতে অন্যের ঠিকানার অস্তিত্ব ফাঁস না হয়। */
  private async assertOwn(userId: string, id: string): Promise<{ isDefault: boolean }> {
    const address = await this.prisma.address.findFirst({
      where: { id, userId },
      select: { isDefault: true },
    });

    if (!address) {
      throw new NotFoundException('ঠিকানা পাওয়া যায়নি');
    }

    return address;
  }
}
