import { Controller, Get, Param } from '@nestjs/common';
import { CategoryService } from '../catalog/category.service';
import { CategoryPublicDto } from '../catalog/dto/category-public.dto';
import { ProductPublicListItemDto } from '../catalog/dto/product-public-list-item.dto';
import { PublicProductService } from '../catalog/public-product.service';
import { StorePublicResponseDto } from './dto/store-public-response.dto';
import { StoreService } from './store.service';

/** Public storefront resolution: what `inventoai.com/SITENAME` is rendered from. */
@Controller('site')
export class SiteController {
  constructor(
    private readonly storeService: StoreService,
    private readonly categoryService: CategoryService,
    private readonly publicProductService: PublicProductService,
  ) {}

  /**
   * The featured content is assembled here rather than inside
   * `resolvePublicStore`: they are small indexed selects, and joining would fan
   * one store row out over every featured row — but putting them in
   * `StoreService` would make it and the catalog services a provider-level
   * cycle. Controller-level composition keeps `forwardRef` at the module level.
   */
  @Get(':slug')
  async getStore(@Param('slug') slug: string): Promise<StorePublicResponseDto> {
    const { store, theme } = await this.storeService.resolvePublicStore(slug);
    const featuredCategories = await this.categoryService.listFeatured(
      store.id,
    );
    const featuredProducts = await this.publicProductService.listFeatured(
      store.id,
    );

    return StorePublicResponseDto.fromEntity(store, theme, {
      categories: featuredCategories.map((category) =>
        CategoryPublicDto.fromEntity(category),
      ),
      products: featuredProducts.map((product) =>
        ProductPublicListItemDto.fromEntity(product),
      ),
    });
  }
}
