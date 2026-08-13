import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  MAX_PRICE_AMOUNT,
  MAX_STOCK_QUANTITY,
  MAX_VARIANT_AXES_PER_PRODUCT,
  PRODUCT_SKU_MAX_LENGTH,
} from '../catalog.constants';

/**
 * Every field is optional; an omitted one is left alone. `sku` and
 * `compareAtAmount` accept `null` explicitly, which is how the owner clears
 * them — an omitted field cannot express "remove this".
 */
export class UpdateVariantDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(1, PRODUCT_SKU_MAX_LENGTH)
  sku?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_AMOUNT)
  priceAmount?: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_AMOUNT)
  compareAtAmount?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK_QUANTITY)
  stockQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK_QUANTITY)
  lowStockThreshold?: number;

  /** Replaces the combination wholesale; the matrix is re-validated as a whole. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_VARIANT_AXES_PER_PRODUCT)
  @IsUUID(undefined, { each: true })
  attributeValueIds?: string[];
}
