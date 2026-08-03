import { IsBoolean, IsOptional } from 'class-validator';
import { ToBoolean } from '../../common/transformers/to-boolean.transformer';

/**
 * Filters only — no `page`/`limit`. `MAX_ATTRIBUTES_PER_STORE` is 20 and the
 * dashboard renders all of them at once, the same reasoning that left
 * `GET /site/:slug/categories` unpaginated.
 */
export class AttributeQueryDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isVariantAxis?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isFilterable?: boolean;
}
