import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../common/transformers/to-boolean.transformer';
import type { SortOrder } from '../../common/types/sort-order';
import { SORT_ORDERS } from '../../common/types/sort-order';
import { SEARCH_INPUT_MAX_LENGTH } from '../catalog.constants';
import { ProductSort } from '../enums/product-sort.enum';
import { ProductStatus } from '../enums/product-status.enum';

/**
 * Filters for the dashboard list, which unlike the storefront shows drafts and
 * archived rows — that is the point of it.
 */
export class ProductQueryDto extends PaginationQueryDto {
  /**
   * An owner looking for a row they already know exists, not a shopper
   * discovering one: full-text over the product **or** a prefix match on a
   * variant SKU. No fuzzy fallback and no relevance sort — the order belongs to
   * the owner, who is usually sorting by stock or date.
   */
  @IsOptional()
  @IsString()
  @Length(0, SEARCH_INPUT_MAX_LENGTH)
  search?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isFeatured?: boolean;

  /** Any variant at or below its own `lowStockThreshold`. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  lowStock?: boolean;

  @IsOptional()
  @IsEnum(ProductSort)
  sort: ProductSort = ProductSort.CreatedAt;

  @IsOptional()
  @IsIn(SORT_ORDERS)
  order: SortOrder = 'DESC';
}
