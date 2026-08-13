import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MAX_PRICE_AMOUNT,
  MAX_STOCK_QUANTITY,
  MAX_VALUES_PER_ATTRIBUTE,
  MAX_VARIANT_AXES_PER_PRODUCT,
} from '../catalog.constants';

/** One axis of the matrix and the values of it to build with. */
export class VariantAxisDto {
  @IsUUID()
  attributeId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_VALUES_PER_ATTRIBUTE)
  @IsUUID(undefined, { each: true })
  valueIds!: string[];
}

/**
 * The matrix builder: name the axes and the values, and the server produces the
 * cross product in one transaction, skipping the combinations that already
 * exist. Without it the dashboard issues six creates and has to reconcile a
 * partial failure.
 */
export class GenerateVariantsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_VARIANT_AXES_PER_PRODUCT)
  @ValidateNested({ each: true })
  @Type(() => VariantAxisDto)
  axes!: VariantAxisDto[];

  /** The starting price every generated variant shares. */
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_AMOUNT)
  priceAmount!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_STOCK_QUANTITY)
  stockQuantity?: number;
}
