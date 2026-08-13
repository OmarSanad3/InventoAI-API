import { CatalogBatchResult } from '../utils/plan-catalog-write.util';

/**
 * What an apply actually did. The counts and the `skipped` list exist so a
 * second click on the same button reads as "you already have these", not as a
 * silent no-op — and so the dashboard never has to guess why it got fewer
 * categories than it sent.
 */
export class ApplyCatalogResultDto {
  categoriesCreated!: number;
  categoriesSkipped!: number;
  attributesCreated!: number;
  attributesSkipped!: number;
  /** The slugs and keys the store already had, in the order they were sent. */
  skipped!: string[];

  static fromResults(
    categories: CatalogBatchResult,
    attributes: CatalogBatchResult,
  ): ApplyCatalogResultDto {
    const dto = new ApplyCatalogResultDto();
    dto.categoriesCreated = categories.created;
    dto.categoriesSkipped = categories.skipped.length;
    dto.attributesCreated = attributes.created;
    dto.attributesSkipped = attributes.skipped.length;
    dto.skipped = [...categories.skipped, ...attributes.skipped];
    return dto;
  }
}
