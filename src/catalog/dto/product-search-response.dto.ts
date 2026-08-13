import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ProductPublicListItemDto } from './product-public-list-item.dto';

/**
 * How the returned page was found. `exact` is ranked full-text; `fuzzy` means
 * full-text found nothing and the trigram pass ran instead; `null` means no
 * search term was sent at all.
 */
export type SearchMode = 'exact' | 'fuzzy';

/**
 * The storefront listing's envelope. `PaginatedResponseDto` is shared plumbing
 * and stays untouched — the two search fields are added here.
 */
export class ProductSearchResponseDto extends PaginatedResponseDto<ProductPublicListItemDto> {
  searchMode!: SearchMode | null;
  /** Set only when `searchMode` is `fuzzy` and something similar was found. */
  didYouMean!: string | null;

  static ofSearch(
    items: ProductPublicListItemDto[],
    total: number,
    query: PaginationQueryDto,
    search: { mode: SearchMode | null; didYouMean: string | null },
  ): ProductSearchResponseDto {
    const page = PaginatedResponseDto.of(items, total, query);

    const dto = new ProductSearchResponseDto();
    dto.items = page.items;
    dto.total = page.total;
    dto.page = page.page;
    dto.limit = page.limit;
    dto.totalPages = page.totalPages;
    dto.searchMode = search.mode;
    dto.didYouMean = search.didYouMean;
    return dto;
  }
}
