import { PaginationQueryDto } from './pagination-query.dto';

/** The envelope every paginated list endpoint returns. */
export class PaginatedResponseDto<T> {
  items!: T[];
  total!: number;
  page!: number;
  limit!: number;
  totalPages!: number;

  static of<T>(
    items: T[],
    total: number,
    query: PaginationQueryDto,
  ): PaginatedResponseDto<T> {
    const dto = new PaginatedResponseDto<T>();
    dto.items = items;
    dto.total = total;
    dto.page = query.page;
    dto.limit = query.limit;
    dto.totalPages = Math.ceil(total / query.limit);
    return dto;
  }
}
