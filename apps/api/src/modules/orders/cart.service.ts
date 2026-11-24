import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GUEST_TOKEN_BYTES, type AddCartItemInput, type UpdateCartItemInput } from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { cartCreateData, cartWhere, type CartOwner } from './cart-owner';

/**
 * কার্টের আইটেম পড়তে যা লাগে। দাম variant থেকে **তাজা** আসে —
 * `CartItem`-এ দাম জমা রাখা হয় না, নইলে দোকান দাম বদলালে কার্টে
 * পুরোনো দাম আটকে থাকত আর চেকআউটে হিসাব মিলত না।
 */
const ITEM_SELECT = {
  id: true,
  variantId: true,
  quantity: true,
  variant: {
    select: {
      id: true,
      sku: true,
      pricePaisa: true,
      stock: true,
      isActive: true,
      options: { select: { name: true, value: true } },
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          images: { select: { url: true, alt: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
        },
      },
    },
  },
} satisfies Prisma.CartItemSelect;

type CartItemRow = Prisma.CartItemGetPayload<{ select: typeof ITEM_SELECT }>;

export interface CartItemView {
  id: string;
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  sku: string;
  optionsText: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPricePaisa: number;
  lineTotalPaisa: number;
  /** কার্টে রাখার পর স্টক কমে গেলে UI সতর্ক করতে পারে */
  stock: number;
  isAvailable: boolean;
}

export interface CartView {
  items: CartItemView[];
  subtotalPaisa: number;
  itemCount: number;
}

/** "Size: L, Color: Black" — অর্ডারে এই লেখাটাই কপি হয়ে যায়। */
export function formatOptions(options: readonly { name: string; value: string }[]): string | null {
  if (options.length === 0) {
    return null;
  }

  return options.map((option) => `${option.name}: ${option.value}`).join(', ');
}

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * গেস্টকে নতুন টোকেন দেওয়া — **সার্ভারই বানায়, ক্লায়েন্ট নয়**।
   *
   * ক্লায়েন্টকে বানাতে দিলে কেউ `guest-1`, `guest-2` পাঠিয়ে অন্যের
   * কার্ট খুলে ফেলত। `randomBytes` ব্যবহার করা হয় (`Math.random`
   * নয়) কারণ এই টোকেনটাই কার্টের একমাত্র চাবি — অনুমানযোগ্য হলে
   * ক্রেতার ঠিকানা আর কী কিনছে সব দেখা যেত।
   *
   * **কার্টের row এখনই তৈরি হয় না।** খালি কার্ট জমিয়ে লাভ নেই;
   * যে টোকেন নিয়ে কেউ কিছু যোগ করল না, তার জন্য DB-তে কিছু পড়ে
   * থাকবে না। প্রথম আইটেম যোগ করার সময় `upsert` row বানায়।
   */
  issueGuestToken(): { guestToken: string } {
    return { guestToken: randomBytes(GUEST_TOKEN_BYTES).toString('hex') };
  }

  /**
   * লগইনের পর গেস্ট কার্ট সদস্যের কার্টে মিশিয়ে দেওয়া।
   *
   * **কেন দরকার:** ক্রেতা কার্ট ভরে, তারপর চেকআউটে গিয়ে লগইন করে।
   * না মেশালে ঠিক সেই মুহূর্তে তার কার্ট খালি হয়ে যেত — যে ক্রেতা
   * কিনতে সবচেয়ে কাছে এসেছে, তাকেই হারানো হতো।
   *
   * **পরিমাণ যোগ হয়**, একটা অন্যটাকে মুছে দেয় না। যোগ করাটা
   * নিখুঁত নয় (সে হয়তো ২টাই চেয়েছিল), কিন্তু "কম দেখানো"-র চেয়ে
   * "বেশি দেখানো" ভালো: কার্টে সংখ্যা কমানো এক ক্লিকের কাজ, আর
   * হারিয়ে যাওয়া পণ্য সে আর খুঁজেই পেত না।
   *
   * **স্টকের চেয়ে বেশি হলে স্টকেই থামে, ত্রুটি দেয় না** — লগইনের
   * মুহূর্তে "স্টকে মাত্র ২টা" বলে পুরো মেশানো আটকে দিলে ক্রেতা
   * বাকি পণ্যগুলোও হারাত। চেকআউট এমনিতেও স্টক আবার যাচাই করে।
   *
   * গেস্ট কার্টটা শেষে **মুছে ফেলা হয়**, নইলে পরে আবার মেশানো
   * গিয়ে পরিমাণ দুবার যোগ হতো।
   */
  async merge(userId: string, guestToken: string | null): Promise<CartView> {
    const owner: CartOwner = { kind: 'user', userId };

    if (guestToken === null) {
      return this.view(owner);
    }

    const guestCart = await this.prisma.cart.findUnique({
      where: { guestToken },
      select: {
        id: true,
        items: {
          select: {
            variantId: true,
            quantity: true,
            variant: { select: { stock: true, isActive: true } },
          },
        },
      },
    });

    if (guestCart === null || guestCart.items.length === 0) {
      // অনুমান করা টোকেন বা খালি কার্ট — চুপচাপ নিজের কার্টই ফেরে
      return this.view(owner);
    }

    await this.prisma.$transaction(async (tx) => {
      const target = await tx.cart.upsert({
        where: { userId },
        create: { userId },
        update: {},
        select: { id: true },
      });

      for (const item of guestCart.items) {
        if (!item.variant.isActive) {
          // বিক্রি বন্ধ হয়ে যাওয়া পণ্য টেনে আনার মানে নেই
          continue;
        }

        const existing = await tx.cartItem.findUnique({
          where: { cartId_variantId: { cartId: target.id, variantId: item.variantId } },
          select: { quantity: true },
        });

        const wanted = (existing?.quantity ?? 0) + item.quantity;

        await tx.cartItem.upsert({
          where: { cartId_variantId: { cartId: target.id, variantId: item.variantId } },
          create: {
            cartId: target.id,
            variantId: item.variantId,
            quantity: Math.min(item.quantity, item.variant.stock),
          },
          update: { quantity: Math.min(wanted, item.variant.stock) },
        });
      }

      // গেস্ট কার্ট মুছে ফেলা — নইলে পরে আবার মেশালে দুবার যোগ হতো
      await tx.cart.delete({ where: { id: guestCart.id } });
    });

    return this.view(owner);
  }

  /**
   * কার্ট দেখা।
   *
   * `owner` `null` হতে পারে — প্রথমবার আসা ক্রেতার কাছে এখনো গেস্ট
   * টোকেন নেই। তাকে খালি কার্ট দেখানোই সঠিক; ত্রুটি দিলে সাইট
   * খোলার সাথেই ভাঙা দেখাত।
   */
  async view(owner: CartOwner | null): Promise<CartView> {
    if (owner === null) {
      return toCartView([]);
    }

    const cart = await this.prisma.cart.findUnique({
      where: cartWhere(owner),
      select: { items: { select: ITEM_SELECT, orderBy: { id: 'asc' } } },
    });

    return toCartView(cart?.items ?? []);
  }

  /**
   * একই variant আবার যোগ করলে নতুন row নয়, **পরিমাণ যোগ** হয় —
   * `@@unique([cartId, variantId])` সেটাই দাবি করে, আর ইউজারও
   * কার্টে একই পণ্য দুবার দেখতে চায় না।
   *
   * লক্ষ করো: `input`-এ দাম নেই। ক্লায়েন্ট দাম পাঠালেও Zod schema
   * সেটা ফেলে দেয় — দাম এখানে কখনো ইনপুট নয়।
   */
  async addItem(owner: CartOwner, input: AddCartItemInput): Promise<CartView> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: input.variantId },
      select: { id: true, stock: true, isActive: true, product: { select: { isPublished: true } } },
    });

    if (!variant || !variant.isActive || !variant.product.isPublished) {
      throw new NotFoundException('পণ্যটি পাওয়া যায়নি');
    }

    const cart = await this.prisma.cart.upsert({
      where: cartWhere(owner),
      create: cartCreateData(owner),
      update: {},
      select: { id: true },
    });

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } },
      select: { id: true, quantity: true },
    });

    const nextQuantity = (existing?.quantity ?? 0) + input.quantity;

    /**
     * এখানে স্টক দেখা হচ্ছে শুধু **সৌজন্যে** — তাড়াতাড়ি জানানোর জন্য।
     * আসল রক্ষা চেকআউটের conditional update-এ, কারণ কার্টে রাখা আর
     * অর্ডার করার মাঝে স্টক বদলে যেতে পারে।
     */
    this.assertStock(nextQuantity, variant.stock);

    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } },
      create: { cartId: cart.id, variantId: input.variantId, quantity: input.quantity },
      update: { quantity: nextQuantity },
    });

    return this.view(owner);
  }

  async updateItem(
    owner: CartOwner,
    itemId: string,
    input: UpdateCartItemInput,
  ): Promise<CartView> {
    const item = await this.findOwnItem(owner, itemId);

    this.assertStock(input.quantity, item.variant.stock);

    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: input.quantity },
    });

    return this.view(owner);
  }

  async removeItem(owner: CartOwner, itemId: string): Promise<CartView> {
    const item = await this.findOwnItem(owner, itemId);

    await this.prisma.cartItem.delete({ where: { id: item.id } });

    return this.view(owner);
  }

  /**
   * আইটেম **আর মালিক দুটোই** মিলতে হবে।
   *
   * শুধু `id` দিয়ে খুঁজলে আইডি অনুমান করে বা অন্য জায়গা থেকে জেনে
   * নিয়ে কেউ অন্যের কার্ট বদলে ফেলত। না মিললে 404 — "নেই" আর
   * "তোমার নয়" একই উত্তর, যাতে আইটেমের অস্তিত্বও ফাঁস না হয়।
   */
  private async findOwnItem(
    owner: CartOwner,
    itemId: string,
  ): Promise<{ id: string; variant: { stock: number } }> {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cart: cartWhere(owner) },
      select: { id: true, variant: { select: { stock: true } } },
    });

    if (!item) {
      throw new NotFoundException('কার্টে এই আইটেম নেই');
    }

    return item;
  }

  private assertStock(wanted: number, stock: number): void {
    if (wanted > stock) {
      throw new ConflictException(
        stock === 0 ? 'পণ্যটি স্টকে নেই' : `স্টকে আছে মাত্র ${stock}টা`,
      );
    }
  }
}

export function toCartView(items: readonly CartItemRow[]): CartView {
  const views = items.map((item) => {
    const unitPricePaisa = item.variant.pricePaisa;

    return {
      id: item.id,
      variantId: item.variantId,
      productId: item.variant.product.id,
      productName: item.variant.product.name,
      productSlug: item.variant.product.slug,
      sku: item.variant.sku,
      optionsText: formatOptions(item.variant.options),
      imageUrl: item.variant.product.images[0]?.url ?? null,
      quantity: item.quantity,
      unitPricePaisa,
      // সব হিসাব integer paisa-তে — float নিলে পয়সা হারায়
      lineTotalPaisa: unitPricePaisa * item.quantity,
      stock: item.variant.stock,
      isAvailable: item.variant.isActive && item.variant.stock >= item.quantity,
    };
  });

  return {
    items: views,
    subtotalPaisa: views.reduce((sum, item) => sum + item.lineTotalPaisa, 0),
    itemCount: views.reduce((sum, item) => sum + item.quantity, 0),
  };
}
