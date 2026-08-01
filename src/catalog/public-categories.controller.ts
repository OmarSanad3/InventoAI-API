import { Controller, Get, Param } from '@nestjs/common';
import { CategoryService } from './category.service';
import { CategoryPublicDto } from './dto/category-public.dto';

/**
 * The storefront half of the catalog: what `inventoai.com/SITENAME` navigates
 * with. No guard — a live store's categories are public. A draft slug 404s,
 * because `resolvePublicStore` hides it.
 */
@Controller('site/:slug/categories')
export class PublicCategoriesController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get()
  async list(@Param('slug') slug: string): Promise<CategoryPublicDto[]> {
    const categories = await this.categoryService.listPublished(slug);
    return categories.map((category) => CategoryPublicDto.fromEntity(category));
  }
}
