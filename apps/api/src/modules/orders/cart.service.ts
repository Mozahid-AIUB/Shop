import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AddCartItemInput, UpdateCartItemInput } from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';

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

  async view(userId: string): Promise<CartView> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
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
  async addItem(userId: string, input: AddCartItemInput): Promise<CartView> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: input.variantId },
      select: { id: true, stock: true, isActive: true, product: { select: { isPublished: true } } },
    });

    if (!variant || !variant.isActive || !variant.product.isPublished) {
      throw new NotFoundException('পণ্যটি পাওয়া যায়নি');
    }

    const cart = await this.prisma.cart.upsert({
      where: { userId },
      create: { userId },
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

    return this.view(userId);
  }

  /**
   * `userId` শর্তে থাকা জরুরি — আইডি অনুমান করে অন্যের কার্ট বদলানো
   * ঠেকায়। না থাকলে 404, "নেই" আর "তোমার নয়" একই উত্তর দেয় যাতে
   * কার্ট আইটেমের অস্তিত্ব ফাঁস না হয়।
   */
  async updateItem(userId: string, itemId: string, input: UpdateCartItemInput): Promise<CartView> {
    const item = await this.findOwnItem(userId, itemId);

    this.assertStock(input.quantity, item.variant.stock);

    await this.prisma.cartItem.update({
      where: { id: item.id },
      data: { quantity: input.quantity },
    });

    return this.view(userId);
  }

  async removeItem(userId: string, itemId: string): Promise<CartView> {
    const item = await this.findOwnItem(userId, itemId);

    await this.prisma.cartItem.delete({ where: { id: item.id } });

    return this.view(userId);
  }

  private async findOwnItem(
    userId: string,
    itemId: string,
  ): Promise<{ id: string; variant: { stock: number } }> {
    const item = await this.prisma.cartItem.findFirst({
      where: { id: itemId, cart: { userId } },
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
