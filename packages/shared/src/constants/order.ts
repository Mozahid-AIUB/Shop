/**
 * অর্ডারের জীবনচক্র। Phase 06/08-এ state machine এই ক্রম ধরে চলবে।
 * DB-তে Prisma enum হিসেবেও একই নাম থাকবে — দুই দিকে মিল রাখা বাধ্যতামূলক।
 */
export const ORDER_STATUSES = [
  'PENDING',
  'DESIGN_CONFIRMED',
  'IN_PRODUCTION',
  'PRINTED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** কোন status থেকে কোথায় যাওয়া যায়। Phase 08-এ guard এটাই ব্যবহার করবে। */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['DESIGN_CONFIRMED', 'CANCELLED'],
  DESIGN_CONFIRMED: ['IN_PRODUCTION', 'CANCELLED'],
  IN_PRODUCTION: ['PRINTED', 'CANCELLED'],
  PRINTED: ['SHIPPED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PRINT_METHODS = ['SCREEN_PRINT', 'DTG', 'VINYL', 'SUBLIMATION'] as const;
export type PrintMethod = (typeof PRINT_METHODS)[number];

/** ডিজাইন শার্টের কোথায় বসবে। */
export const PRINT_PLACEMENTS = ['FRONT', 'BACK', 'LEFT_CHEST', 'RIGHT_CHEST', 'SLEEVE', 'FULL'] as const;
export type PrintPlacement = (typeof PRINT_PLACEMENTS)[number];
