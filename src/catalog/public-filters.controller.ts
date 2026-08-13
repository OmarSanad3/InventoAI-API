import { Controller, Get, Param, Query } from '@nestjs/common';
import { PublicProductQueryDto } from './dto/public-product-query.dto';
import { StoreFiltersDto } from './dto/store-filters.dto';
import { ProductFilterService } from './product-filter.service';

/**
 * What the storefront sidebar renders itself from. It deliberately takes the
 * **same** query DTO as the product listing: the counts only mean anything if
 * they reflect the filters already applied.
 */
@Controller('site/:slug/filters')
export class PublicFiltersController {
  constructor(private readonly productFilterService: ProductFilterService) {}

  @Get()
  async getFilters(
    @Param('slug') slug: string,
    @Query() query: PublicProductQueryDto,
  ): Promise<StoreFiltersDto> {
    return this.productFilterService.build(slug, query);
  }
}
