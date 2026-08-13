import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../common/transformers/to-boolean.transformer';
import {
  CATEGORY_SLUG_MAX_LENGTH,
  MAX_PRICE_AMOUNT,
  SEARCH_INPUT_MAX_LENGTH,
} from '../catalog.constants';
import { PublicProductSort } from '../enums/product-sort.enum';

/** How long an `?attributes=` string may be before it is refused outright. */
const ATTRIBUTE_FILTER_MAX_LENGTH = 500;

/**
 * The storefront listing's query string. Also what `GET /site/:slug/filters`
 * takes, because the sidebar's counts have to reflect the filters already
 * applied.
 */
export class PublicProductQueryDto extends PaginationQueryDto {
  /** Category **slug**, not id — `?category=kitchen`. */
  @IsOptional()
  @IsString()
  @Length(1, CATEGORY_SLUG_MAX_LENGTH)
  category?: string;

  /** Truncated to `SEARCH_QUERY_MAX_LENGTH`, never rejected for being long. */
  @IsOptional()
  @IsString()
  @Length(0, SEARCH_INPUT_MAX_LENGTH)
  search?: string;

  /** Minor units, inclusive, against the product's cheapest variant. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_AMOUNT)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE_AMOUNT)
  maxPrice?: number;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  inStock?: boolean;

  /**
   * The store's own facets, as one whitelisted parameter carrying a small
   * grammar: `?attributes=size:xl,l;color:red` — OR within a facet, AND across
   * facets. A `?size=xl` cannot work: `forbidNonWhitelisted` would 400 it,
   * because no DTO can declare a field that is a row in a store's database.
   */
  @IsOptional()
  @IsString()
  @Length(1, ATTRIBUTE_FILTER_MAX_LENGTH)
  attributes?: string;

  /**
   * Left undefined on purpose: `relevance` when a search is present, `newest`
   * otherwise. Sending `relevance` with no search degrades to `newest` rather
   * than 400 — these URLs get shared, and clearing the search box must not land
   * the shopper on an error page.
   */
  @IsOptional()
  @IsEnum(PublicProductSort)
  sort?: PublicProductSort;
}
