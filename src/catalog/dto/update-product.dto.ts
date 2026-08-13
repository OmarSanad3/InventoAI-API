import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import {
  MAX_PRODUCT_ATTRIBUTE_VALUES,
  MAX_PRODUCT_CATEGORIES,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_SEARCH_KEYWORDS_MAX_LENGTH,
  PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_SLUG_MAX_LENGTH,
  PRODUCT_SLUG_MIN_LENGTH,
  PRODUCT_TITLE_MAX_LENGTH,
  PRODUCT_TITLE_MIN_LENGTH,
} from '../catalog.constants';
import { ProductStatus } from '../enums/product-status.enum';

const MAX_WEIGHT_GRAMS = 1_000_000;

/**
 * Variants are **not** editable here — they have their own routes, because a
 * partial variant list in a product patch cannot express "delete this one"
 * without also being able to orphan an order's line item.
 *
 * `categoryIds` and `attributeValueIds` replace their lists wholesale when
 * present, and are left alone when omitted.
 */
export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(PRODUCT_TITLE_MIN_LENGTH, PRODUCT_TITLE_MAX_LENGTH)
  title?: string;

  @IsOptional()
  @IsSlug()
  @Length(PRODUCT_SLUG_MIN_LENGTH, PRODUCT_SLUG_MAX_LENGTH)
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(0, PRODUCT_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH)
  shortDescription?: string;

  @IsOptional()
  @IsString()
  @Length(0, PRODUCT_SEARCH_KEYWORDS_MAX_LENGTH)
  searchKeywords?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_WEIGHT_GRAMS)
  weightGrams?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_CATEGORIES)
  @IsUUID(undefined, { each: true })
  categoryIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_ATTRIBUTE_VALUES)
  @IsUUID(undefined, { each: true })
  attributeValueIds?: string[];
}
