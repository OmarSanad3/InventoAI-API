import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { IsSlug } from '../../common/validators/is-slug.decorator';
import {
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_NAME_MIN_LENGTH,
  CATEGORY_SLUG_MAX_LENGTH,
  CATEGORY_SLUG_MIN_LENGTH,
} from '../catalog.constants';

/**
 * Every field optional; an omitted one is left alone. Renaming does **not**
 * re-slug — a live category's URL is a customer-visible address, so moving it
 * takes an explicit `slug`.
 *
 * Hand-written rather than `PartialType(CreateCategoryDto)`:
 * `@nestjs/mapped-types` is not a dependency, and the site-builder DTOs are
 * written this way too.
 */
export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @Length(CATEGORY_NAME_MIN_LENGTH, CATEGORY_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsSlug()
  @Length(CATEGORY_SLUG_MIN_LENGTH, CATEGORY_SLUG_MAX_LENGTH)
  slug?: string;

  /** An empty string clears the description. */
  @IsOptional()
  @IsString()
  @Length(0, CATEGORY_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;
}
