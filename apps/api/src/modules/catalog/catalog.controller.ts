import { Controller, Get, Param, Query } from '@nestjs/common';
import { productListQuerySchema, type ProductListQuery } from '@shop/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { CategoriesService, type CategoryNode } from './categories.service';
import { ProductsService, type ProductDetail, type ProductListResult } from './products.service';

/**
 * Storefront-এর খোলা API। লগইন লাগে না, তাই সবকিছু `@Public()`।
 * খসড়া প্রোডাক্ট এখান দিয়ে কখনো বেরোবে না — service-এ `isPublished` বাঁধা।
 */
@Controller()
export class CatalogController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
  ) {}

  @Public()
  @Get('products')
  list(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery): Promise<ProductListResult> {
    return this.products.list(query);
  }

  @Public()
  @Get('products/:slug')
  detail(@Param('slug') slug: string): Promise<ProductDetail> {
    return this.products.findPublishedBySlug(slug);
  }

  @Public()
  @Get('categories')
  tree(): Promise<CategoryNode[]> {
    return this.categories.tree();
  }
}
