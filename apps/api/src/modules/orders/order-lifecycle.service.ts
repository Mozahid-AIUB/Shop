import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type OrderStatus } from '@prisma/client';
import {
  ACTIVITY_ACTIONS,
  canTransition,
  isCancellable,
  type CancelOrderInput,
  type ChangeOrderStatusInput,
  type OrderListQuery,
  type Role,
  type TrackOrderInput,
} from '@shop/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityLogService } from '../admin/activity-log/activity-log.service';

const DETAIL_SELECT = {
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
} satisfies Prisma.OrderSelect;

const BOARD_SELECT = {
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
}

/**
 * কোন role কোন transition করতে পারে।
 *
 * `DESIGNER` শুধু নিজের ধাপটাই এগোয় — ডিজাইন অনুমোদিত হলে প্রোডাকশনে
 * পাঠানো। ডেলিভারি বা বাতিল তার কাজ নয়, তাই আলাদা করে লেখা।
 */
const DESIGNER_ALLOWED: readonly { from: OrderStatus; to: OrderStatus }[] = [
  { from: 'DESIGN_CONFIRMED', to: 'IN_PRODUCTION' },
  { from: 'IN_PRODUCTION', to: 'PRINTED' },
];

@Injectable()
export class OrderLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  /**
   * Staff-এর status বদল। নিয়ম `packages/shared`-এর transition map
   * থেকেই আসে, তাই UI যে বাটন দেখায় সার্ভার সেটাই মানে।
   */
  async changeStatus(
    orderNumber: string,
    input: ChangeOrderStatusInput,
    actor: { id: string; role: Role },
  ): Promise<OrderFullDetail> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: { id: true, status: true },
    });

    if (!order) {
      throw new NotFoundException('অর্ডার পাওয়া যায়নি');
    }

    if (!canTransition(order.status, input.toStatus)) {
      throw new ConflictException(
        `${order.status} থেকে ${input.toStatus}-এ নেওয়া যায় না`,
      );
    }

    this.assertRoleMayMove(actor.role, order.status, input.toStatus);

    await this.prisma.$transaction(async (tx) => {
      await this.applyStatus(tx, {
        orderId: order.id,
        from: order.status,
        to: input.toStatus,
        changedById: actor.id,
        note: input.note ?? null,
      });
    });

    /**
     * লগ transaction-এর **বাইরে**: rollback হলে ঘটনাটা ঘটেইনি,
     * তাই লগও থাকা উচিত নয়। আর ভেতরে রাখলে লগ লেখার ব্যর্থতা
     * পুরো status বদল ফেলে দিত।
     */
    await this.activity.record({
      actorId: actor.id,
      action: ACTIVITY_ACTIONS.ORDER_STATUS_CHANGED,
      entityType: 'Order',
      entityId: order.id,
      summary: `${order.status} → ${input.toStatus}`,
    });

    return this.findForStaff(orderNumber);
  }

  /**
   * কাস্টমার নিজের অর্ডার বাতিল করে — শুধু `PENDING` অবস্থায়।
   * এরপর কাজ শুরু হয়ে যায়, তখন স্টাফকে বলতে হবে।
   */
  async cancelByCustomer(
    userId: string,
    orderNumber: string,
    input: CancelOrderInput,
  ): Promise<OrderFullDetail> {
    const order = await this.prisma.order.findFirst({
      where: { orderNumber, userId },
      select: { id: true, status: true },
    });

    if (!order) {
      throw new NotFoundException('অর্ডার পাওয়া যায়নি');
    }

    /**
     * কাস্টমার শুধু `PENDING` অবস্থায় নিজে বাতিল করতে পারে। এর পরে
     * ডিজাইন/ছাপার কাজ শুরু হয়ে যায়, তখন স্টাফের সিদ্ধান্ত লাগে।
     *
     * `isCancellable` দিয়েও যাচাই হচ্ছে, যাতে transition map-এ কখনো
     * `PENDING → CANCELLED` তুলে দিলে এই পথও বন্ধ হয়ে যায় — নিয়ম
     * দুই জায়গায় আলাদা হয়ে না থাকে।
     */
    if (order.status !== 'PENDING' || !isCancellable(order.status)) {
      throw new ConflictException(
        'কাজ শুরু হয়ে গেছে — বাতিল করতে আমাদের সাথে যোগাযোগ করুন',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.applyStatus(tx, {
        orderId: order.id,
        from: order.status,
        to: 'CANCELLED',
        changedById: userId,
        note: input.reason,
      });
    });

    await this.activity.record({
      actorId: userId,
      action: ACTIVITY_ACTIONS.ORDER_CANCELLED,
      entityType: 'Order',
      entityId: order.id,
      summary: `cancelled by customer: ${input.reason}`,
    });

    return this.findForStaff(orderNumber);
  }

  /**
   * Public tracking — Order ID **আর** ফোন, দুটোই মিলতে হবে।
   *
   * নম্বরে তারিখ ও সিরিয়াল থাকায় (`ORD-2026-1123-018`) শুধু ID
   * দিয়ে খুঁজতে দিলে কেউ ০০১ থেকে গুনে সব অর্ডার দেখে ফেলত।
   */
  async track(input: TrackOrderInput): Promise<PublicTrackingView> {
    const order = await this.prisma.order.findFirst({
      where: {
        orderNumber: input.orderNumber,
        /**
         * অর্ডারের **স্ন্যাপশট** ফোনে মেলানো হচ্ছে, ইউজারের প্রোফাইলে নয় —
         * কাস্টমার পরে প্রোফাইলের নম্বর বদলালেও পুরোনো অর্ডার ট্র্যাক করা যাবে।
         */
        shipPhone: input.phone,
      },
      select: {
        orderNumber: true,
        status: true,
        createdAt: true,
        shipCity: true,
        shipDistrict: true,
        items: { select: { productName: true, optionsText: true, quantity: true } },
        history: { select: { toStatus: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
    });

    if (!order) {
      // "নম্বর ভুল" আর "ফোন ভুল" — একই উত্তর, নইলে নম্বর যাচাই করা যেত
      throw new NotFoundException('এই তথ্যে কোনো অর্ডার পাওয়া যায়নি');
    }

    return {
      orderNumber: order.orderNumber,
      status: order.status,
      placedAt: order.createdAt,
      shipCity: order.shipCity,
      shipDistrict: order.shipDistrict,
      items: order.items,
      history: order.history,
    };
  }

  /** অ্যাডমিন বোর্ড — খোঁজা, ছাঁকা, পাতায় পাতায়। */
  async board(query: OrderListQuery): Promise<OrderBoardPage> {
    const where = this.buildWhere(query);

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: BOARD_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      orders: rows.map(({ items, ...order }) => ({ ...order, itemCount: items.length })),
      total,
      page: query.page,
      perPage: query.perPage,
      pageCount: Math.max(Math.ceil(total / query.perPage), 1),
    };
  }

  async findForStaff(orderNumber: string): Promise<OrderFullDetail> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: DETAIL_SELECT,
    });

    if (!order) {
      throw new NotFoundException('অর্ডার পাওয়া যায়নি');
    }

    return order;
  }

  /**
   * status বসায়, ইতিহাসে লেখে, আর বাতিল হলে স্টক ফেরত দেয় —
   * সবটা caller-এর transaction-এর ভেতরে, তাই অর্ধেক হওয়ার সুযোগ নেই।
   */
  private async applyStatus(
    tx: Prisma.TransactionClient,
    input: {
      orderId: string;
      from: OrderStatus;
      to: OrderStatus;
      changedById: string;
      note: string | null;
    },
  ): Promise<void> {
    await tx.order.update({
      where: { id: input.orderId },
      data: { status: input.to },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: input.orderId,
        fromStatus: input.from,
        toStatus: input.to,
        changedById: input.changedById,
        note: input.note,
      },
    });

    if (input.to === 'CANCELLED') {
      await this.returnStock(tx, input.orderId);
    }
  }

  /**
   * বাতিল হলে স্টক ফেরত। না দিলে বিক্রি না হওয়া পণ্য স্টকে নেই
   * দেখাত আর দোকান বেচতে পারত না।
   *
   * `variantId` null হতে পারে (variant মুছে গেলে SetNull) — তখন
   * ফেরত দেওয়ার কিছু নেই, তাই বাদ।
   */
  private async returnStock(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
    const items = await tx.orderItem.findMany({
      where: { orderId, variantId: { not: null } },
      select: { variantId: true, quantity: true },
    });

    for (const item of items) {
      if (item.variantId === null) {
        continue;
      }

      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { increment: item.quantity } },
      });
    }
  }

  private assertRoleMayMove(role: Role, from: OrderStatus, to: OrderStatus): void {
    if (role === 'SUPER_ADMIN' || role === 'ORDER_MANAGER') {
      return;
    }

    if (role === 'DESIGNER') {
      const allowed = DESIGNER_ALLOWED.some((move) => move.from === from && move.to === to);

      if (!allowed) {
        throw new ForbiddenException('এই ধাপ বদলানোর অনুমতি নেই');
      }

      return;
    }

    throw new ForbiddenException('এই ধাপ বদলানোর অনুমতি নেই');
  }

  /**
   * খোঁজা হয় orderNumber, শিপিং ফোন আর নামে। ইমেইলে নয় —
   * ফোনেই কাস্টমার নিজেকে চেনায়, আর স্টাফ ফোন ধরেই খোঁজে।
   */
  private buildWhere(query: OrderListQuery): Prisma.OrderWhereInput {
    const where: Prisma.OrderWhereInput = {};

    if (query.search !== undefined && query.search.length > 0) {
      where.OR = [
        { orderNumber: { contains: query.search, mode: 'insensitive' } },
        { shipPhone: { contains: query.search } },
        { shipFullName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.status !== undefined) {
      where.status = query.status;
    }

    if (query.paymentStatus !== undefined) {
      where.paymentStatus = query.paymentStatus;
    }

    const createdAt = this.buildDateRange(query.from, query.to);

    if (createdAt !== undefined) {
      where.createdAt = createdAt;
    }

    return where;
  }

  /**
   * তারিখ সার্ভারের **লোকাল দিন** ধরে — ব্যবসা বাংলাদেশে, তাই
   * "আজকের অর্ডার" মানে ঢাকার আজ। `to`-তে পুরো দিনটা ধরতে
   * পরদিনের শুরু পর্যন্ত নেওয়া হয়।
   */
  private buildDateRange(
    from: string | undefined,
    to: string | undefined,
  ): Prisma.DateTimeFilter | undefined {
    if (from === undefined && to === undefined) {
      return undefined;
    }

    const filter: Prisma.DateTimeFilter = {};

    if (from !== undefined) {
      filter.gte = new Date(`${from}T00:00:00`);
    }

    if (to !== undefined) {
      const end = new Date(`${to}T00:00:00`);
      end.setDate(end.getDate() + 1);
      filter.lt = end;
    }

    return filter;
  }
}
