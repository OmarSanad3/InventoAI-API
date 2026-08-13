import { ProductVariant } from '../entities/product-variant.entity';
import { AttributeValueRefDto } from './attribute-value-ref.dto';

/**
 * A variant as the dashboard sees it — exact stock included, which is exactly
 * what `VariantPublicDto` refuses to publish.
 */
export class VariantResponseDto {
  id!: string;
  sku!: string | null;
  priceAmount!: number;
  compareAtAmount!: number | null;
  stockQuantity!: number;
  lowStockThreshold!: number;
  isDefault!: boolean;
  position!: number;
  attributeValues!: AttributeValueRefDto[];

  static fromEntity(variant: ProductVariant): VariantResponseDto {
    const dto = new VariantResponseDto();
    dto.id = variant.id;
    dto.sku = variant.sku;
    dto.priceAmount = variant.priceAmount;
    dto.compareAtAmount = variant.compareAtAmount;
    dto.stockQuantity = variant.stockQuantity;
    dto.lowStockThreshold = variant.lowStockThreshold;
    dto.isDefault = variant.isDefault;
    dto.position = variant.position;
    dto.attributeValues = (variant.attributeValues ?? []).map((value) =>
      AttributeValueRefDto.fromEntity(value),
    );
    return dto;
  }
}
