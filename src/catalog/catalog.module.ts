import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RolesGuard } from '../common/guards/roles.guard';
import { SiteBuilderModule } from '../site-builder/site-builder.module';
import { CatalogAiService } from './catalog-ai.service';
import { CatalogSearchInitializer } from './catalog-search.initializer';
import { CatalogSetupController } from './catalog-setup.controller';
import { CategoriesController } from './categories.controller';
import { CategoryService } from './category.service';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';
import { ProductAttribute } from './entities/product-attribute.entity';
import { ProductAttributeValue } from './entities/product-attribute-value.entity';
import { ProductImage } from './entities/product-image.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { ProductAttributeService } from './product-attribute.service';
import { ProductAttributesController } from './product-attributes.controller';
import { ProductFilterService } from './product-filter.service';
import { ProductImageService } from './product-image.service';
import { ProductVariantService } from './product-variant.service';
import { ProductService } from './product.service';
import { ProductsController } from './products.controller';
import { PublicCategoriesController } from './public-categories.controller';
import { PublicFiltersController } from './public-filters.controller';
import { PublicProductService } from './public-product.service';
import { PublicProductsController } from './public-products.controller';

/**
 * `forwardRef` because the dependency genuinely goes both ways: the catalog
 * resolves its store through `StoreService`, and the landing page's featured
 * strips come from `CategoryService` and `PublicProductService`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Category,
      Product,
      ProductAttribute,
      ProductAttributeValue,
      ProductImage,
      ProductVariant,
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => SiteBuilderModule),
  ],
  controllers: [
    CatalogSetupController,
    CategoriesController,
    ProductAttributesController,
    ProductsController,
    PublicCategoriesController,
    PublicFiltersController,
    PublicProductsController,
  ],
  providers: [
    CatalogAiService,
    CatalogSearchInitializer,
    CategoryService,
    ProductAttributeService,
    ProductFilterService,
    ProductImageService,
    ProductService,
    ProductVariantService,
    PublicProductService,
    RolesGuard,
  ],
  exports: [
    CategoryService,
    ProductAttributeService,
    ProductService,
    PublicProductService,
  ],
})
export class CatalogModule {}
