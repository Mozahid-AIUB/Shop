import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AdminPaymentsController, CustomerPaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  // ActivityLogService-এর জন্য — পেমেন্ট লেখা ও বাতিল লগে যায়
  imports: [AdminModule],
  controllers: [CustomerPaymentsController, AdminPaymentsController],
  providers: [PaymentsService],
  // Phase 09-এর রিপোর্টে revenue vs due হিসাব করতে লাগবে
  exports: [PaymentsService],
})
export class PaymentsModule {}
