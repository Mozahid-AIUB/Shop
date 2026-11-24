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

/**
 * এক status থেকে আরেকটায় যাওয়া যায় কিনা।
 *
 * API guard আর UI-র বাটন — দুই জায়গায় **এই একটাই** নিয়ম চলে,
 * তাই অ্যাডমিন যে বাটন দেখে সেটা চাপলে সার্ভার না বলবে না।
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/** এখন থেকে যেখানে যাওয়া যায় — UI-তে বাটন বানাতে। */
export function nextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_STATUS_TRANSITIONS[from];
}

/** আর কোথাও যাওয়ার নেই — অর্ডার শেষ। */
export const isTerminalStatus = (status: OrderStatus): boolean =>
  ORDER_STATUS_TRANSITIONS[status].length === 0;

/**
 * বাতিল করা যাবে কিনা। ছাপা হয়ে গেলে (`PRINTED`) আর নয় —
 * কাপড় ও কাজ দুটোই খরচ হয়ে গেছে, তখন বাতিল মানে লোকসান।
 * টাকা ফেরতের সিদ্ধান্ত আলাদা, সেটা পেমেন্টের দিকে।
 */
export const isCancellable = (status: OrderStatus): boolean =>
  ORDER_STATUS_TRANSITIONS[status].includes('CANCELLED');

export const PAYMENT_STATUSES = ['UNPAID', 'PARTIAL', 'PAID', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * courier আর shipment-এর constants — পুরোটা `constants/courier.ts`-এ (Phase 10)।
 *
 * এখান থেকে re-export, যাতে পুরোনো import ভাঙে না।
 */
export { COURIERS, SHIPMENT_STATUSES } from './courier';
export type { Courier, ShipmentStatus } from './courier';

/**
 * COD ঢ়ুঁকির স্তর — Phase 13।
 * বাংলাদেশে COD-এ ভুয়া অর্ডারে কুরিয়ার খরচ জলে যায়, তাই এটা দরকারি।
 */
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'BLOCKED'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
