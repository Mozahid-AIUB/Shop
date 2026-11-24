import { Module } from '@nestjs/common';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogController } from './catalog.controller';
import { CategoriesService } from './categories.service';
import { ProductsService } from './products.service';
import { SearchService } from './search.service';

@Module({
  controllers: [CatalogController, CatalogAdminController],
  providers: [ProductsService, CategoriesService, SearchService],
  exports: [ProductsService],
})
export class CatalogModule {}
