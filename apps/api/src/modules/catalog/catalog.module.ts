import { Module } from '@nestjs/common';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogController } from './catalog.controller';
import { CategoriesService } from './categories.service';
import { ProductsService } from './products.service';

@Module({
  controllers: [CatalogController, CatalogAdminController],
  providers: [ProductsService, CategoriesService],
  exports: [ProductsService],
})
export class CatalogModule {}
