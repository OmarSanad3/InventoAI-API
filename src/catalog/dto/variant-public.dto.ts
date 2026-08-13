import { PUBLIC_STOCK_HINT_THRESHOLD } from '../catalog.constants';
import { ProductAttributeValue } from '../entities/product-attribute-value.entity';
import { ProductVariant } from '../entities/product-variant.entity';

/** One axis value that defines a variant, addressed by slug rather than id. */
export class VariantOptionDto {
  attributeKey!: string;
  attributeName!: string;
  value!: string;
  slug!: string;
  swatchHex!: string | null;

  static fromEntity(value: ProductAttributeValue): VariantOptionDto {
    const dto = new VariantOptionDto();
    dto.attributeKey = value.attribute?.key ?? '';
    dto.attributeName = value.attribute?.name ?? '';
    dto.value = value.value;
    dto.slug = value.slug;
    dto.swatchHex = value.swatchHex;
    return dto;
  }
}

/**
 * A variant as a shopper sees it. Stock is exposed **only** as a capped hint:
 * publishing exact inventory tells competitors the store's sales rate, and
 * `"stockLeft": 3` gives the shopper the urgency without the leak.
 */
export class VariantPublicDto {
  id!: string;
  priceAmount!: number;
  compareAtAmount!: number | null;
  inStock!: boolean;
  /** Set only at or below `PUBLIC_STOCK_HINT_THRESHOLD`, else `null`. */
  stockLeft!: number | null;
  options!: VariantOptionDto[];

  static fromEntity(variant: ProductVariant): VariantPublicDto {
    const dto = new VariantPublicDto();
    dto.id = variant.id;
    dto.priceAmount = variant.priceAmount;
    dto.compareAtAmount = variant.compareAtAmount;
    dto.inStock = variant.stockQuantity > 0;
    dto.stockLeft =
      variant.stockQuantity > 0 &&
      variant.stockQuantity <= PUBLIC_STOCK_HINT_THRESHOLD
        ? variant.stockQuantity
        : null;
    dto.options = (variant.attributeValues ?? []).map((value) =>
      VariantOptionDto.fromEntity(value),
    );
    return dto;
  }
}
