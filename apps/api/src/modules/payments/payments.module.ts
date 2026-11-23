import { Module } from '@nestjs/common';
import { AdminPaymentsController, CustomerPaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [CustomerPaymentsController, AdminPaymentsController],
  providers: [PaymentsService],
  // Phase 09-এর রিপোর্টে revenue vs due হিসাব করতে লাগবে
  exports: [PaymentsService],
})
export class PaymentsModule {}
