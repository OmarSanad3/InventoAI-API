import { Product } from '../entities/product.entity';
import { AttributeDisplayStyle } from '../enums/attribute-display-style.enum';
import { findPrimaryImage } from '../utils/primary-image.util';
import { CategoryPublicDto } from './category-public.dto';
import { VariantOptionDto } from './variant-public.dto';

/**
 * A product card on the storefront listing.
 *
 * `minPriceAmount` and `maxPriceAmount` are both here and equal for a simple
 * product, so the client renders "249.00" or "from 249.00" from the numbers
 * alone rather than from a flag it has to trust.
 */
export class ProductPublicListItemDto {
  title!: string;
  slug!: string;
  shortDescription!: string | null;
  imageUrl!: string | null;
  imageAltText!: string | null;
  categories!: CategoryPublicDto[];
  minPriceAmount!: number;
  maxPriceAmount!: number;
  inStock!: boolean;
  /** The swatch-styled axis values, so the card can preview its colours. */
  swatches!: VariantOptionDto[];

  static fromEntity(product: Product): ProductPublicListItemDto {
    const primaryImage = findPrimaryImage(product.images);

    const dto = new ProductPublicListItemDto();
    dto.title = product.title;
    dto.slug = product.slug;
    dto.shortDescription = product.shortDescription;
    dto.imageUrl = primaryImage?.url ?? null;
    dto.imageAltText = primaryImage?.altText ?? null;
    dto.categories = (product.categories ?? [])
      .filter((category) => category.isPublished)
      .map((category) => CategoryPublicDto.fromEntity(category));
    dto.minPriceAmount = product.minPriceAmount;
    dto.maxPriceAmount = product.maxPriceAmount;
    dto.inStock = product.totalStock > 0;
    dto.swatches = collectSwatches(product);
    return dto;
  }
}

/** Every distinct swatch-styled value across the product's variants, once each. */
function collectSwatches(product: Product): VariantOptionDto[] {
  const bySlug = new Map<string, VariantOptionDto>();

  for (const variant of product.variants ?? []) {
    for (const value of variant.attributeValues ?? []) {
      const isSwatch =
        value.attribute?.displayStyle === AttributeDisplayStyle.Swatch;
      if (isSwatch && !bySlug.has(value.slug)) {
        bySlug.set(value.slug, VariantOptionDto.fromEntity(value));
      }
    }
  }

  return [...bySlug.values()];
}
