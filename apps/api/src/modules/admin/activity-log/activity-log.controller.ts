import { Controller, Get, Query } from '@nestjs/common';
import { activityLogQuerySchema, type ActivityLogQuery } from '@shop/shared';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ActivityLogService, type ActivityLogPage } from './activity-log.service';

/**
 * অডিট লগ — **শুধু `SUPER_ADMIN`**।
 *
 * লগে কে কখন কী করেছে লেখা থাকে, অর্থাৎ এটা কর্মীদের উপর
 * নজরদারির তথ্য। ম্যানেজারকেও দেওয়া হয়নি।
 *
 * মোছার কোনো endpoint নেই, আর থাকবেও না — অডিট ট্রেইল মোছা গেলে
 * সেটা আর অডিট নয়।
 */
@Roles('SUPER_ADMIN')
@Controller('admin/activity')
export class ActivityLogController {
  constructor(private readonly activity: ActivityLogService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(activityLogQuerySchema)) query: ActivityLogQuery,
  ): Promise<ActivityLogPage> {
    return this.activity.list(query);
  }
}
