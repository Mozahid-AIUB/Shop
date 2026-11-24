import { Controller, Get, Query } from '@nestjs/common';
import {
  bestSellerQuerySchema,
  reportRangeSchema,
  type BestSeller,
  type DailySalesPoint,
  type RepeatCustomer,
  type ReportRange,
  type ReportSummary,
  type StatusBreakdownRow,
} from '@shop/shared';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ReportsService } from './reports.service';

type BestSellerQuery = ReportRange & { limit: number };

/**
 * ব্যবসার রিপোর্ট।
 *
 * **শুধু `SUPER_ADMIN`** — আয়, বকেয়া আর ক্রেতার তালিকা ব্যবসার
 * সবচেয়ে সংবেদনশীল তথ্য। প্রোডাকশন বা ডিজাইনের কাজে এগুলো লাগে না,
 * আর যত কম লোক দেখে তত কম ফাঁস হওয়ার পথ থাকে।
 *
 * পরে অন্য role-কে দিতে হলে এই এক জায়গায় যোগ করলেই হবে।
 */
@Roles('SUPER_ADMIN')
@Controller('admin/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** ordered / collected / due — COD-তে তিনটাই আলাদা সংখ্যা। */
  @Get('summary')
  summary(
    @Query(new ZodValidationPipe(reportRangeSchema)) query: ReportRange,
  ): Promise<ReportSummary> {
    return this.reports.summary(query);
  }

  @Get('sales')
  sales(
    @Query(new ZodValidationPipe(reportRangeSchema)) query: ReportRange,
  ): Promise<DailySalesPoint[]> {
    return this.reports.dailySales(query);
  }

  @Get('best-sellers')
  bestSellers(
    @Query(new ZodValidationPipe(bestSellerQuerySchema)) query: BestSellerQuery,
  ): Promise<BestSeller[]> {
    return this.reports.bestSellers(query, query.limit);
  }

  /** কোন status-এ কত অর্ডার আটকে — কার্যত কাজের তালিকা। */
  @Get('status-breakdown')
  statusBreakdown(
    @Query(new ZodValidationPipe(reportRangeSchema)) query: ReportRange,
  ): Promise<StatusBreakdownRow[]> {
    return this.reports.statusBreakdown(query);
  }

  @Get('repeat-customers')
  repeatCustomers(
    @Query(new ZodValidationPipe(bestSellerQuerySchema)) query: BestSellerQuery,
  ): Promise<RepeatCustomer[]> {
    return this.reports.repeatCustomers(query, query.limit);
  }
}
