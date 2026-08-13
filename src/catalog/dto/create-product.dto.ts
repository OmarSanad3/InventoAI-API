import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import {
  MAX_PRODUCT_ATTRIBUTE_VALUES,
  MAX_PRODUCT_CATEGORIES,
  MAX_VARIANTS_PER_PRODUCT,
  PRODUCT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_SEARCH_KEYWORDS_MAX_LENGTH,
  PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH,
  PRODUCT_SLUG_MAX_LENGTH,
  PRODUCT_SLUG_MIN_LENGTH,
  PRODUCT_TITLE_MAX_LENGTH,
  PRODUCT_TITLE_MIN_LENGTH,
} from '../catalog.constants';
import { ProductStatus } from '../enums/product-status.enum';
import { CreateVariantDto } from './create-variant.dto';

const MAX_WEIGHT_GRAMS = 1_000_000;

/**
 * There is deliberately no `storeId`: `forbidNonWhitelisted` then turns any
 * attempt to send one into a 400, and the store always comes from the JWT.
 */
export class CreateProductDto {
  @IsString()
  @Length(PRODUCT_TITLE_MIN_LENGTH, PRODUCT_TITLE_MAX_LENGTH)
  title!: string;

  /** Omitted means "derive it from the title". */
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

  /** Words shoppers use that the product copy does not — `sneakers, trainers`. */
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
  @IsInt()
  @Min(0)
  @Max(MAX_WEIGHT_GRAMS)
  weightGrams?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_CATEGORIES)
  @IsUUID(undefined, { each: true })
  categoryIds?: string[];

  /** **Descriptive** values only — an axis value here is a 400. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PRODUCT_ATTRIBUTE_VALUES)
  @IsUUID(undefined, { each: true })
  attributeValueIds?: string[];

  /** Required: every product has at least one variant, simple ones included. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_VARIANTS_PER_PRODUCT)
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants!: CreateVariantDto[];
}
