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
 * There is deliberately no `storeId`: `forbidNonWhitelisted` then turns any
 * attempt to send one into a 400, and the store always comes from the JWT.
 */
export class CreateCategoryDto {
  @IsString()
  @Length(CATEGORY_NAME_MIN_LENGTH, CATEGORY_NAME_MAX_LENGTH)
  name!: string;

  /** Omitted means "derive it from the name". */
  @IsOptional()
  @IsSlug()
  @Length(CATEGORY_SLUG_MIN_LENGTH, CATEGORY_SLUG_MAX_LENGTH)
  slug?: string;

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
