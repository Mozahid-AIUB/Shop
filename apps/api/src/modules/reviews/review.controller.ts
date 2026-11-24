import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  adminReviewListQuerySchema,
  reviewInputSchema,
  reviewListQuerySchema,
  reviewModerationSchema,
  reviewReplySchema,
  reviewUpdateSchema,
  type AccessTokenPayload,
  type AdminReviewListQuery,
  type ReviewInput,
  type ReviewListQuery,
  type ReviewModerationInput,
  type ReviewReplyInput,
  type ReviewUpdateInput,
} from '@shop/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  ReviewService,
  type AdminReview,
  type OwnReview,
  type PublicReviewPage,
  type ReviewPage,
} from './review.service';

/**
 * Reviews, split by who is allowed to do what.
 *
 * Three controllers rather than one, because the audiences differ in
 * what they may see as much as in what they may do: the public never
 * sees an unapproved review or a reviewer's email, the customer sees
 * their own unapproved reviews, and staff see everything. Keeping them
 * apart means a route cannot accidentally inherit the wrong guard.
 */

/** ক্রেতার নিজের রিভিউ — লগইন বাধ্যতামূলক, তাই কোনো `@Public()` নেই। */
@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(reviewInputSchema)) input: ReviewInput,
  ): Promise<OwnReview> {
    return this.reviews.create(user.sub, input);
  }

  /**
   * `:id`-এর আগে, নইলে "mine" একটা রিভিউ আইডি ধরে নেওয়া হতো।
   * Nest ঘোষণার ক্রমে route মেলায়।
   */
  @Get('mine')
  listMine(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodValidationPipe(reviewListQuerySchema)) query: ReviewListQuery,
  ): Promise<ReviewPage<OwnReview>> {
    return this.reviews.listMine(user.sub, query);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewUpdateSchema)) input: ReviewUpdateInput,
  ): Promise<OwnReview> {
    return this.reviews.update(user.sub, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AccessTokenPayload, @Param('id') id: string): Promise<void> {
    return this.reviews.remove(user.sub, id);
  }
}

/** পণ্যের পাতার রিভিউ — খোলা, আর শুধু অনুমোদিতগুলো। */
@Controller('products')
export class ProductReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Public()
  @Get(':slug/reviews')
  list(
    @Param('slug') slug: string,
    @Query(new ZodValidationPipe(reviewListQuerySchema)) query: ReviewListQuery,
  ): Promise<PublicReviewPage> {
    return this.reviews.listForProduct(slug, query);
  }
}

/**
 * অ্যাডমিনের moderation।
 *
 * `ORDER_MANAGER`-ও পারে, কারণ দোকানে রিভিউর জবাব দেওয়া রোজকার কাজ —
 * শুধু `SUPER_ADMIN` পারলে মালিক ছুটিতে গেলে গালিগালাজ সাইটে বসে
 * থাকত।
 */
@Roles('SUPER_ADMIN', 'ORDER_MANAGER')
@Controller('admin/reviews')
export class ReviewAdminController {
  constructor(private readonly reviews: ReviewService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(adminReviewListQuerySchema)) query: AdminReviewListQuery,
  ): Promise<ReviewPage<AdminReview>> {
    return this.reviews.listForAdmin(query);
  }

  @Patch(':id/moderation')
  moderate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewModerationSchema)) input: ReviewModerationInput,
  ): Promise<AdminReview> {
    return this.reviews.moderate(id, input);
  }

  @Patch(':id/reply')
  reply(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reviewReplySchema)) input: ReviewReplyInput,
  ): Promise<AdminReview> {
    return this.reviews.reply(id, input);
  }
}
