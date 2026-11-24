import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ActivityAction, ActivityLogQuery } from '@shop/shared';
import { PrismaService } from '../../../prisma/prisma.service';

const LOG_SELECT = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  summary: true,
  createdAt: true,
  actor: { select: { id: true, name: true, email: true, role: true } },
} satisfies Prisma.ActivityLogSelect;

export type ActivityLogRow = Prisma.ActivityLogGetPayload<{ select: typeof LOG_SELECT }>;

export interface ActivityLogPage {
  entries: ActivityLogRow[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
}

export interface RecordActivityInput {
  /** null মানে সিস্টেম — cron বা webhook */
  actorId: string | null;
  action: ActivityAction;
  entityType: 'Order' | 'Payment' | 'Product' | 'ProductionTask';
  entityId: string;
  summary?: string | null;
}

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * ঘটনা লিখে রাখে। **কখনো throw করে না।**
   *
   * লগ লেখা মূল কাজের পাশে চলে, ভেতরে নয় — অডিট লেখা ব্যর্থ হলে
   * অর্ডারের status বদল বা পেমেন্ট আটকে যাওয়া অনেক বড় ক্ষতি।
   * তাই ব্যর্থতা শুধু সার্ভার লগে যায়, caller-এর কাছে ফেরে না।
   *
   * ইচ্ছাকৃতভাবে caller-এর transaction-এর **বাইরে**: transaction
   * rollback হলে ঘটনাটা সত্যিই ঘটেনি, তাই লগও থাকা উচিত নয় —
   * কিন্তু transaction-এর ভেতরে রাখলে লগের ব্যর্থতা মূল কাজ ফেলে দিত।
   */
  async record(input: RecordActivityInput): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          actorId: input.actorId,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          summary: input.summary ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write activity log for ${input.action} on ${input.entityType}:${input.entityId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async list(query: ActivityLogQuery): Promise<ActivityLogPage> {
    const where: Prisma.ActivityLogWhereInput = {};

    if (query.action !== undefined) {
      where.action = query.action;
    }

    if (query.entityType !== undefined) {
      where.entityType = query.entityType;
    }

    if (query.entityId !== undefined) {
      where.entityId = query.entityId;
    }

    if (query.actorId !== undefined) {
      where.actorId = query.actorId;
    }

    const [entries, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        select: LOG_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return {
      entries,
      total,
      page: query.page,
      perPage: query.perPage,
      pageCount: Math.max(Math.ceil(total / query.perPage), 1),
    };
  }
}
