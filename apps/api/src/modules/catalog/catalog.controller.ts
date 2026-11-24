import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  productListQuerySchema,
  productSearchQuerySchema,
  type ProductListQuery,
  type ProductSearchQuery,
  type ProductSearchResult,
} from '@shop/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { CategoriesService, type CategoryNode } from './categories.service';
import { ProductsService, type ProductDetail, type ProductListResult } from './products.service';
import { SearchService, type SearchItem } from './search.service';

/**
 * Storefront-এর খোলা API। লগইন লাগে না, তাই সবকিছু `@Public()`।
 * খসড়া প্রোডাক্ট এখান দিয়ে কখনো বেরোবে না — service-এ `isPublished` বাঁধা।
 */
@Controller()
export class CatalogController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly productSearch: SearchService,
  ) {}

  @Public()
  @Get('products')
  list(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery): Promise<ProductListResult> {
    return this.products.list(query);
  }

  /**
   * `products/:slug`-এর **আগে** থাকতে হবে।
   *
   * Nest route-গুলো ঘোষণার ক্রমে মেলায়, তাই পরে থাকলে `/products/search`
   * কে "search" নামের slug ধরে নিত আর সবসময় ৪০৪ দিত।
   */
  @Public()
  @Get('products/search')
  search(
    @Query(new ZodValidationPipe(productSearchQuerySchema)) query: ProductSearchQuery,
  ): Promise<ProductSearchResult<SearchItem>> {
    return this.productSearch.search(query);
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
