import { Product } from '../entities/product.entity';
import { findPrimaryImage } from '../utils/primary-image.util';

/**
 * One row of the autocomplete dropdown: the cheapest select the storefront can
 * render a suggestion from. Never paginated, capped at `SEARCH_SUGGEST_LIMIT`.
 */
export class ProductSuggestionDto {
  title!: string;
  slug!: string;
  imageUrl!: string | null;
  minPriceAmount!: number;

  static fromEntity(product: Product): ProductSuggestionDto {
    const dto = new ProductSuggestionDto();
    dto.title = product.title;
    dto.slug = product.slug;
    dto.imageUrl = findPrimaryImage(product.images)?.url ?? null;
    dto.minPriceAmount = product.minPriceAmount;
    return dto;
  }
}
