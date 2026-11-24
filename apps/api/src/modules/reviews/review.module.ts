import { Module } from '@nestjs/common';
import {
  ProductReviewController,
  ReviewAdminController,
  ReviewController,
} from './review.controller';
import { ReviewService } from './review.service';

/**
 * `ReviewService` রপ্তানি করা হয় কারণ catalog-এর তালিকা ও detail
 * পণ্যের রেটিং দেখায় — সেই হিসাবটা দুই জায়গায় লেখা চলবে না।
 */
@Module({
  controllers: [ReviewController, ProductReviewController, ReviewAdminController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
