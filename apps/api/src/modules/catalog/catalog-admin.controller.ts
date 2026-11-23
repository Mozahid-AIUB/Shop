import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  createCategorySchema,
  createProductSchema,
  updateCategorySchema,
  updateProductSchema,
  updateStockSchema,
  type CreateCategoryInput,
  type CreateProductInput,
  type UpdateCategoryInput,
  type UpdateProductInput,
  type UpdateStockInput,
} from '@shop/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../auth/decorators/roles.decorator';
import { CategoriesService, type CategorySummary } from './categories.service';
import { ProductsService, type ProductDetail, type StockResult } from './products.service';

/**
 * অ্যাডমিন ক্যাটালগ। class-level `@Roles` সব route-এ বসে,
 * তাই নতুন endpoint যোগ করলে সেটাও ডিফল্টে বন্ধ থাকে।
 *
 * মোছা শুধু SUPER_ADMIN পারে — ভুল করে ক্যাটালগ উড়ে যাওয়া ঠেকাতে।
 */
@Roles('SUPER_ADMIN', 'ORDER_MANAGER')
@Controller('admin')
export class CatalogAdminController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
  ) {}

  @Post('categories')
  createCategory(@Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryInput): Promise<CategorySummary> {
    return this.categories.create(body);
  }

  @Patch('categories/:id')
  updateCategory(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategoryInput,
  ): Promise<CategorySummary> {
    return this.categories.update(id, body);
  }

  @Roles('SUPER_ADMIN')
  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCategory(@Param('id') id: string): Promise<void> {
    return this.categories.remove(id);
  }

  @Post('products')
  createProduct(@Body(new ZodValidationPipe(createProductSchema)) body: CreateProductInput): Promise<ProductDetail> {
    return this.products.create(body);
  }

  @Get('products/:id')
  getProduct(@Param('id') id: string): Promise<ProductDetail> {
    return this.products.findByIdForStaff(id);
  }

  @Patch('products/:id')
  updateProduct(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
  ): Promise<ProductDetail> {
    return this.products.update(id, body);
  }

  @Roles('SUPER_ADMIN')
  @Delete('products/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeProduct(@Param('id') id: string): Promise<void> {
    return this.products.remove(id);
  }

  @Patch('variants/:id/stock')
  adjustStock(@Param('id') id: string, @Body(new ZodValidationPipe(updateStockSchema)) body: UpdateStockInput): Promise<StockResult> {
    return this.products.adjustStock(id, body);
  }
}
