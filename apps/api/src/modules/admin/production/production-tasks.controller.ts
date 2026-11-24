import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  assignTaskSchema,
  createTaskSchema,
  taskListQuerySchema,
  updateTaskSchema,
  type AccessTokenPayload,
  type AssignTaskInput,
  type CreateTaskInput,
  type TaskListQuery,
  type UpdateTaskInput,
} from '@shop/shared';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { ProductionTasksService, type TaskPage, type TaskRow } from './production-tasks.service';

/**
 * প্রোডাকশনের কাজ। ডিজাইনারও ঢোকে, কারণ তাকে নিজের কাজ এগোতে হয় —
 * কিন্তু কোন কাজ সে বদলাতে পারবে সেটা service-এ যাচাই হয়
 * (দায়িত্বে না থাকলে ৪০৩)। ACCOUNTANT নেই: টাকার হিসাব তার কাজ,
 * প্রোডাকশন নয়।
 */
@Roles('SUPER_ADMIN', 'ORDER_MANAGER', 'DESIGNER')
@Controller('admin')
export class ProductionTasksController {
  constructor(private readonly tasks: ProductionTasksService) {}

  @Get('tasks')
  list(
    @CurrentUser() user: AccessTokenPayload,
    @Query(new ZodValidationPipe(taskListQuerySchema)) query: TaskListQuery,
  ): Promise<TaskPage> {
    return this.tasks.list(query, { id: user.sub, role: user.role });
  }

  @Patch('tasks/:id')
  update(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTaskInput,
  ): Promise<TaskRow> {
    return this.tasks.update(id, body, { id: user.sub, role: user.role });
  }
}

/**
 * কাজ তৈরি ও বিলি — ডিজাইনার বাদ। সে কাজ করে, কাজ বানায় না।
 * আলাদা controller কারণ class-level `@Roles` আলাদা।
 */
@Roles('SUPER_ADMIN', 'ORDER_MANAGER')
@Controller('admin')
export class TaskManagementController {
  constructor(private readonly tasks: ProductionTasksService) {}

  @Post('orders/:orderNumber/tasks')
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Param('orderNumber') orderNumber: string,
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput,
  ): Promise<TaskRow> {
    return this.tasks.create(orderNumber, body, { id: user.sub, role: user.role });
  }

  @Patch('tasks/:id/assign')
  assign(
    @CurrentUser() user: AccessTokenPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignTaskSchema)) body: AssignTaskInput,
  ): Promise<TaskRow> {
    return this.tasks.assign(id, body, { id: user.sub, role: user.role });
  }
}
