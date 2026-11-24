import { Prisma, type OrderStatus } from '@prisma/client';
import type { Courier, ShipmentStatus } from '@shop/shared';

/**
 * অর্ডার পড়ার আকারগুলো — কোন query কী কী মাঠ আনে।
 *
 * service থেকে আলাদা রাখা হয়েছে কারণ এগুলো **ডেটার আকার**, যুক্তি নয়।
 * একই ফাইলে থাকলে status বদলানোর নিয়ম খুঁজতে গিয়ে ১১০ লাইন
 * select-এর ভেতর দিয়ে যেতে হতো।
 */

export const DETAIL_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  subtotalPaisa: true,
  shippingPaisa: true,
  discountPaisa: true,
  totalPaisa: true,
  shipFullName: true,
  shipPhone: true,
  shipLine1: true,
  shipLine2: true,
  shipCity: true,
  shipDistrict: true,
  shipPostcode: true,
  note: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, phone: true } },
  items: {
    select: {
      id: true,
      productName: true,
      variantSku: true,
      optionsText: true,
      unitPricePaisa: true,
      quantity: true,
      lineTotalPaisa: true,
    },
  },
  history: {
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
      changedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  /**
   * ঝুঁকির হিসাব **কারণসহ** — এই পাতাতেই অ্যাডমিন সিদ্ধান্ত নেয়।
   * শুধু "৬৫" দেখলে কেউ কিছু করতে পারে না; "আগে ২টা অর্ডার ফেরত
   * দিয়েছে" দেখলে সে জানে ফোনে কী জিজ্ঞেস করতে হবে।
   */
  fraudCheck: { select: { score: true, level: true, reasons: true } },
} satisfies Prisma.OrderSelect;

export const BOARD_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  totalPaisa: true,
  shipFullName: true,
  shipPhone: true,
  shipDistrict: true,
  createdAt: true,
  items: { select: { id: true }, },
  /**
   * COD ঝুঁকি — তালিকাতেই দেখানো হয়, কারণ অ্যাডমিন এখান থেকেই
   * সিদ্ধান্ত নেয়। আলাদা পাতায় লুকানো থাকলে কেউ দেখত না।
   *
   * `reasons` এখানে আনা হয় না — তালিকা ভারী হতো। "কেন" জানতে
   * অর্ডারের বিস্তারিত পাতায় যেতে হবে।
   */
  fraudCheck: { select: { score: true, level: true } },
} satisfies Prisma.OrderSelect;

export type OrderFullDetail = Prisma.OrderGetPayload<{ select: typeof DETAIL_SELECT }>;

export interface OrderBoardPage {
  orders: (Omit<Prisma.OrderGetPayload<{ select: typeof BOARD_SELECT }>, 'items'> & {
    itemCount: number;
  })[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
}

/**
 * Public tracking-এ যা দেখানো হয় — **টাকার হিসাব নেই**, ইউজারের
 * পরিচয় নেই, ঠিকানার পুরোটা নেই। লগইন ছাড়া এর বেশি দেখানো ঠিক নয়।
 */
export interface PublicTrackingView {
  orderNumber: string;
  status: OrderStatus;
  placedAt: Date;
  /** শহর/জেলা যথেষ্ট — কাস্টমার বুঝবে কোথায় যাচ্ছে */
  shipCity: string;
  shipDistrict: string;
  items: { productName: string; optionsText: string | null; quantity: number }[];
  history: { toStatus: OrderStatus; createdAt: Date }[];
  /**
   * কুরিয়ারের তথ্য (Phase 10)। `null` = এখনো পাঠানো হয়নি।
   *
   * **ভেতরের আইডি এখানে নেই** — `consignmentId` দিয়ে কুরিয়ারের
   * API-তে কল করা যায়, আর `courierAccountId` দিয়ে কোন অ্যাকাউন্ট
   * সেটা জানা যায়। ক্রেতার দরকার শুধু কোন কুরিয়ার আর কোন নম্বর
   * দিয়ে সে তাদের সাইটে খুঁজবে।
   */
  shipment: {
    courier: Courier;
    trackingCode: string | null;
    status: ShipmentStatus;
    dispatchedAt: Date | null;
    deliveredAt: Date | null;
  } | null;
}
