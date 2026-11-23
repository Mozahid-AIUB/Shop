import { Module } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import {
  ActivityLogController,
  InvoiceController,
  ProductionTasksController,
  TaskManagementController,
} from './admin.controller';
import { InvoiceService } from './invoice.service';
import { ProductionTasksService } from './production-tasks.service';

@Module({
  controllers: [
    ProductionTasksController,
    TaskManagementController,
    ActivityLogController,
    InvoiceController,
  ],
  providers: [ProductionTasksService, ActivityLogService, InvoiceService],
  /**
   * `ActivityLogService` বাইরে দেওয়া হচ্ছে কারণ orders আর payments
   * module নিজেদের ঘটনা লিখবে — লগ এক জায়গা থেকেই লেখা হোক।
   */
  exports: [ActivityLogService],
})
export class AdminModule {}
