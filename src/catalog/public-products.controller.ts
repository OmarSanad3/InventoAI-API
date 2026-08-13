import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductPublicDto } from './dto/product-public.dto';
import { ProductPublicListItemDto } from './dto/product-public-list-item.dto';
import { ProductSearchResponseDto } from './dto/product-search-response.dto';
import { ProductSuggestionDto } from './dto/product-suggestion.dto';
import { PublicProductQueryDto } from './dto/public-product-query.dto';
import { PublicProductService } from './public-product.service';

/**
 * The storefront's product surface. No guard — a live store's active products
 * are public. A draft store 404s because `resolvePublicStore` hides it, and a
 * draft product 404s on its own slug rather than merely missing from the list.
 */
@Controller('site/:slug/products')
export class PublicProductsController {
  constructor(private readonly publicProductService: PublicProductService) {}

  @Get()
  async list(
    @Param('slug') slug: string,
    @Query() query: PublicProductQueryDto,
  ): Promise<ProductSearchResponseDto> {
    const result = await this.publicProductService.search(slug, query);
    return ProductSearchResponseDto.ofSearch(
      result.products.map((product) =>
        ProductPublicListItemDto.fromEntity(product),
      ),
      result.total,
      query,
      { mode: result.mode, didYouMean: result.didYouMean },
    );
  }

  /**
   * Declared **before** `:productSlug`, or `suggest` resolves as a product slug —
   * the same declaration-order rule the dashboard's `reorder` follows.
   */
  @Get('suggest')
  async suggest(
    @Param('slug') slug: string,
    @Query() query: PublicProductQueryDto,
  ): Promise<ProductSuggestionDto[]> {
    const products = await this.publicProductService.suggest(
      slug,
      query.search,
    );
    return products.map((product) => ProductSuggestionDto.fromEntity(product));
  }

  @Get(':productSlug')
  async getBySlug(
    @Param('slug') slug: string,
    @Param('productSlug') productSlug: string,
  ): Promise<ProductPublicDto> {
    const product = await this.publicProductService.getBySlug(
      slug,
      productSlug,
    );
    return ProductPublicDto.fromEntity(product);
  }
}
