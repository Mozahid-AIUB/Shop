import { Module } from '@nestjs/common';
import { ActivityLogController } from './activity-log/activity-log.controller';
import { ActivityLogService } from './activity-log/activity-log.service';
import { InvoiceController } from './invoice/invoice.controller';
import { InvoiceService } from './invoice/invoice.service';
import {
  ProductionTasksController,
  TaskManagementController,
} from './production/production-tasks.controller';
import { ProductionTasksService } from './production/production-tasks.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';

/**
 * অ্যাডমিন প্যানেল। প্রতিটা দায়িত্ব নিজের ফোল্ডারে —
 * `production/`, `activity-log/`, `invoice/`, `reports/`।
 */
@Module({
  controllers: [
    ProductionTasksController,
    TaskManagementController,
    ActivityLogController,
    InvoiceController,
    ReportsController,
  ],
  providers: [ProductionTasksService, ActivityLogService, InvoiceService, ReportsService],
  /**
   * `ActivityLogService` বাইরে দেওয়া হচ্ছে কারণ orders আর payments
   * module নিজেদের ঘটনা লিখবে — লগ এক জায়গা থেকেই লেখা হোক।
   */
  exports: [ActivityLogService],
})
export class AdminModule {}
