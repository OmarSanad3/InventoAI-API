import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * The pagination half of every list endpoint's query string. Feature query DTOs
 * extend it and add their own filters.
 *
 * `@Type(() => Number)` is required: the global `ValidationPipe` transforms but
 * does not enable implicit conversion, so a query param arrives as a string.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = DEFAULT_PAGE;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  /** Rows to skip for this page — what a query builder's `.skip()` wants. */
  get offset(): number {
    return (this.page - 1) * this.limit;
  }
}
