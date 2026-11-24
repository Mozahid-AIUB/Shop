import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ACTIVITY_ACTIONS,
  isStaff,
  isTaskClosed,
  type AssignTaskInput,
  type CreateTaskInput,
  type Role,
  type TaskListQuery,
  type UpdateTaskInput,
} from '@shop/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

const TASK_SELECT = {
  id: true,
  kind: true,
  status: true,
  note: true,
  dueAt: true,
  createdAt: true,
  updatedAt: true,
  order: { select: { id: true, orderNumber: true, status: true } },
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ProductionTaskSelect;

export type TaskRow = Prisma.ProductionTaskGetPayload<{ select: typeof TASK_SELECT }>;

export interface TaskPage {
  tasks: TaskRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
}

export interface Actor {
  id: string;
  role: Role;
}

/** কাজ বিলি ও তৈরি করতে পারে যারা — ডিজাইনার কাজ করে, বিলি করে না। */
const MAY_MANAGE: readonly Role[] = ['SUPER_ADMIN', 'ORDER_MANAGER'];

@Injectable()
export class ProductionTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  async create(orderNumber: string, input: CreateTaskInput, actor: Actor): Promise<TaskRow> {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: { id: true },
    });

    if (!order) {
      throw new NotFoundException('অর্ডার পাওয়া যায়নি');
    }

    if (input.assignedToId !== null && input.assignedToId !== undefined) {
      await this.assertAssignable(input.assignedToId);
    }

    const task = await this.prisma.productionTask.create({
      data: {
        orderId: order.id,
        kind: input.kind,
        assignedToId: input.assignedToId ?? null,
        note: input.note ?? null,
        dueAt: input.dueAt === null || input.dueAt === undefined ? null : new Date(input.dueAt),
        createdById: actor.id,
      },
      select: TASK_SELECT,
    });

    await this.activity.record({
      actorId: actor.id,
      action: ACTIVITY_ACTIONS.TASK_CREATED,
      entityType: 'ProductionTask',
      entityId: task.id,
      summary: `${task.kind} task opened on ${orderNumber}`,
    });

    return task;
  }

  /**
   * কাজের অবস্থা বা নোট বদল।
   *
   * দায়িত্বে থাকা কর্মী নিজের কাজ বদলাতে পারে; ম্যানেজার যেকোনোটা
   * (কর্মী ছুটিতে গেলে কাজ আটকে থাকা চলবে না)।
   */
  async update(taskId: string, input: UpdateTaskInput, actor: Actor): Promise<TaskRow> {
    const task = await this.prisma.productionTask.findUnique({
      where: { id: taskId },
      select: { id: true, status: true, assignedToId: true },
    });

    if (!task) {
      throw new NotFoundException('কাজ পাওয়া যায়নি');
    }

    this.assertMayEdit(task, actor);

    /**
     * শেষ বা বাতিল হওয়া কাজ আবার খোলা যায় না — কাজের ইতিহাস
     * ঘোলা হয়ে যায়। নতুন দরকার হলে নতুন কাজ খুলতে হবে।
     */
    if (isTaskClosed(task.status) && input.status !== undefined) {
      throw new ConflictException('শেষ হওয়া কাজ আবার খোলা যাবে না — নতুন কাজ খুলুন');
    }

    const updated = await this.prisma.productionTask.update({
      where: { id: task.id },
      data: {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(input.dueAt === undefined
          ? {}
          : { dueAt: input.dueAt === null ? null : new Date(input.dueAt) }),
      },
      select: TASK_SELECT,
    });

    if (input.status !== undefined) {
      await this.activity.record({
        actorId: actor.id,
        action: ACTIVITY_ACTIONS.TASK_STATUS_CHANGED,
        entityType: 'ProductionTask',
        entityId: task.id,
        summary: `${task.status} → ${input.status}`,
      });
    }

    return updated;
  }

  /** কাকে দেওয়া হবে। `null` মানে assign তুলে নেওয়া — কাজ আবার খোলা। */
  async assign(taskId: string, input: AssignTaskInput, actor: Actor): Promise<TaskRow> {
    const task = await this.prisma.productionTask.findUnique({
      where: { id: taskId },
      select: { id: true },
    });

    if (!task) {
      throw new NotFoundException('কাজ পাওয়া যায়নি');
    }

    if (input.assignedToId !== null) {
      await this.assertAssignable(input.assignedToId);
    }

    const updated = await this.prisma.productionTask.update({
      where: { id: task.id },
      data: { assignedToId: input.assignedToId },
      select: TASK_SELECT,
    });

    await this.activity.record({
      actorId: actor.id,
      action: ACTIVITY_ACTIONS.TASK_ASSIGNED,
      entityType: 'ProductionTask',
      entityId: task.id,
      summary:
        input.assignedToId === null
          ? 'unassigned'
          : `assigned to ${updated.assignedTo?.email ?? input.assignedToId}`,
    });

    return updated;
  }

  async list(query: TaskListQuery, actor: Actor): Promise<TaskPage> {
    const where: Prisma.ProductionTaskWhereInput = {};

    if (query.status !== undefined) {
      where.status = query.status;
    }

    if (query.kind !== undefined) {
      where.kind = query.kind;
    }

    /**
     * `mine=true` নিজের আইডি বসায়। কর্মীর সবচেয়ে বেশি দরকারি দৃশ্য,
     * আর নিজের আইডি টাইপ করতে হয় না।
     */
    if (query.mine === true) {
      where.assignedToId = actor.id;
    } else if (query.assignedToId !== undefined) {
      where.assignedToId = query.assignedToId;
    }

    if (query.orderNumber !== undefined) {
      where.order = { orderNumber: query.orderNumber };
    }

    const [tasks, total] = await Promise.all([
      this.prisma.productionTask.findMany({
        where,
        select: TASK_SELECT,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.productionTask.count({ where }),
    ]);

    return {
      tasks,
      total,
      page: query.page,
      perPage: query.perPage,
      pageCount: Math.max(Math.ceil(total / query.perPage), 1),
    };
  }

  /**
   * দায়িত্বে থাকা কর্মী নিজের কাজ বদলাতে পারে, ম্যানেজার সব।
   * না হলে একজনের কাজ আরেকজন "শেষ" লিখে দিতে পারত।
   */
  private assertMayEdit(task: { assignedToId: string | null }, actor: Actor): void {
    if (MAY_MANAGE.includes(actor.role)) {
      return;
    }

    if (task.assignedToId !== actor.id) {
      throw new ForbiddenException('এই কাজ আপনার নয়');
    }
  }

  /**
   * কাজ শুধু কর্মীকে দেওয়া যায়। কাস্টমারকে দিলে সে অ্যাডমিন
   * বোর্ডে নিজের নাম দেখত আর কাজের তালিকা অর্থহীন হয়ে যেত।
   */
  private async assertAssignable(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isActive: true },
    });

    if (!user) {
      throw new NotFoundException('কর্মী পাওয়া যায়নি');
    }

    if (!isStaff(user.role) || !user.isActive) {
      throw new BadRequestException('কাজ শুধু সক্রিয় কর্মীকে দেওয়া যাবে');
    }
  }
}
