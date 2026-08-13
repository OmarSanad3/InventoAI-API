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
} from 'class-validator';
import {
  MAX_PRICE_AMOUNT,
  MAX_STOCK_QUANTITY,
  MAX_VARIANT_AXES_PER_PRODUCT,
  PRODUCT_SKU_MAX_LENGTH,
} from '../catalog.constants';

/**
 * One buyable form of a product. A simple product sends exactly one of these
 * with no `attributeValueIds` — verbose for that case, and deliberately so:
 * one shape means one code path through checkout, stock and orders.
 */
export class CreateVariantDto {
  /** The owner's own code. Unique per store when present. */
  @IsOptional()
  @IsString()
  @Length(1, PRODUCT_SKU_MAX_LENGTH)
  sku?: string;

  /** Integer **minor units**: `24900` is 249.00 EGP. A decimal here is a 400. */
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_AMOUNT)
  priceAmount!: number;

  /** The struck-through "was" price; rejected unless it exceeds `priceAmount`. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_AMOUNT)
  compareAtAmount?: number;

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

  /**
   * The axis values that define this variant — Size and Colour, never Material.
   * A descriptive value here is a 400, because putting Size on the product
   * instead of the variant is the likeliest client mistake and must not be
   * accepted quietly.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_VARIANT_AXES_PER_PRODUCT)
  @IsUUID(undefined, { each: true })
  attributeValueIds?: string[];
}
