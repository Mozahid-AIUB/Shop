/**
 * প্রোডাকশনের কাজ — Prisma enum-এর সাথে **হুবহু** মিল থাকতে হবে।
 *
 * ধরনটা সাধারণ রাখা হয়েছে, ছাপার কাজে নির্দিষ্ট নয়: দোকান এখন
 * যেকোনো পণ্য বিক্রি করে, তাই প্যাকিং বা QC-ও একই টেবিলে ধরবে।
 */

export const PRODUCTION_TASK_KINDS = ['DESIGN', 'PRINT', 'PACKING', 'QC', 'OTHER'] as const;
export type ProductionTaskKind = (typeof PRODUCTION_TASK_KINDS)[number];

export const PRODUCTION_TASK_KIND_LABELS: Record<ProductionTaskKind, string> = {
  DESIGN: 'ডিজাইন',
  PRINT: 'ছাপা',
  PACKING: 'প্যাকিং',
  QC: 'যাচাই',
  OTHER: 'অন্য কাজ',
};

/**
 * স্তর কম রাখা হলো ইচ্ছাকৃতভাবে। বেশি স্তর দিলে কর্মী আপডেট করা
 * বন্ধ করে দেয়, আর তখন বোর্ড দেখে আসল অবস্থা বোঝা যায় না।
 */
export const PRODUCTION_TASK_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'DONE',
  'BLOCKED',
  'CANCELLED',
] as const;
export type ProductionTaskStatus = (typeof PRODUCTION_TASK_STATUSES)[number];

export const PRODUCTION_TASK_STATUS_LABELS: Record<ProductionTaskStatus, string> = {
  PENDING: 'অপেক্ষায়',
  IN_PROGRESS: 'চলছে',
  DONE: 'শেষ',
  BLOCKED: 'আটকে আছে',
  CANCELLED: 'বাতিল',
};

/** কাজ শেষ বা বাতিল হলে আর বদলানোর কিছু নেই। */
export const isTaskClosed = (status: ProductionTaskStatus): boolean =>
  status === 'DONE' || status === 'CANCELLED';

/**
 * অডিট লগের action নাম — একই নাম সব জায়গায় লিখতে হবে, নইলে
 * ছাঁকার সময় কিছু ঘটনা বাদ পড়ে যাবে।
 */
export const ACTIVITY_ACTIONS = {
  ORDER_STATUS_CHANGED: 'order.status_changed',
  ORDER_CANCELLED: 'order.cancelled',
  PAYMENT_RECORDED: 'payment.recorded',
  PAYMENT_VOIDED: 'payment.voided',
  TASK_CREATED: 'task.created',
  TASK_ASSIGNED: 'task.assigned',
  TASK_STATUS_CHANGED: 'task.status_changed',
} as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[keyof typeof ACTIVITY_ACTIONS];
