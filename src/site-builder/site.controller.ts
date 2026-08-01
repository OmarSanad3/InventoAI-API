import { Controller, Get, Param } from '@nestjs/common';
import { CategoryService } from '../catalog/category.service';
import { CategoryPublicDto } from '../catalog/dto/category-public.dto';
import { StorePublicResponseDto } from './dto/store-public-response.dto';
import { StoreService } from './store.service';

/** Public storefront resolution: what `inventoai.com/SITENAME` is rendered from. */
@Controller('site')
export class SiteController {
  constructor(
    private readonly storeService: StoreService,
    private readonly categoryService: CategoryService,
  ) {}

  /**
   * The featured content is a second small indexed select rather than a join:
   * joining would fan one store row out over every featured row.
   */
  @Get(':slug')
  async getStore(@Param('slug') slug: string): Promise<StorePublicResponseDto> {
    const { store, theme } = await this.storeService.resolvePublicStore(slug);
    const featuredCategories = await this.categoryService.listFeatured(
      store.id,
    );
    return StorePublicResponseDto.fromEntity(store, theme, {
      categories: featuredCategories.map((category) =>
        CategoryPublicDto.fromEntity(category),
      ),
    });
  }
}
