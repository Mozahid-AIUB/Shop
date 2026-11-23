import { z } from 'zod';
import {
  PRODUCTION_TASK_KINDS,
  PRODUCTION_TASK_STATUSES,
} from '../constants/production';

/** প্রোডাকশনের কাজ ও অডিট লগের validation। */

export const createTaskSchema = z.object({
  kind: z.enum(PRODUCTION_TASK_KINDS),
  /** শুরুতেই কাউকে দেওয়া যায়, নাহলে পরে assign হবে */
  assignedToId: z.string().cuid().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  /**
   * কবের মধ্যে শেষ করতে হবে। তারিখ-সময় ISO-তে।
   * অতীতের তারিখ আটকানো হয়নি — পুরোনো কাজ পরে ঢোকানোর দরকার হতে পারে।
   */
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const updateTaskSchema = z
  .object({
    status: z.enum(PRODUCTION_TASK_STATUSES).optional(),
    note: z.string().trim().max(500).nullable().optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: 'অন্তত একটা ফিল্ড বদলাতে হবে' },
  );

export const assignTaskSchema = z.object({
  /** null মানে assign তুলে নেওয়া — কাজটা আবার খোলা হলো */
  assignedToId: z.string().cuid().nullable(),
});

export const taskListQuerySchema = z.object({
  status: z.enum(PRODUCTION_TASK_STATUSES).optional(),
  kind: z.enum(PRODUCTION_TASK_KINDS).optional(),
  assignedToId: z.string().cuid().optional(),
  /** "আমার কাজ" — assignedToId না লিখেই নিজের কাজ দেখা */
  mine: z.coerce.boolean().optional(),
  orderNumber: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export const activityLogQuerySchema = z.object({
  action: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(40).optional(),
  actorId: z.string().cuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type AssignTaskInput = z.infer<typeof assignTaskSchema>;
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
export type ActivityLogQuery = z.infer<typeof activityLogQuerySchema>;
