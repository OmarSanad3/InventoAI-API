import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../common/transformers/to-boolean.transformer';
import { CATEGORY_NAME_MAX_LENGTH } from '../catalog.constants';

/** Filters for the dashboard list, which unlike the storefront shows drafts. */
export class CategoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, CATEGORY_NAME_MAX_LENGTH)
  search?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isFeatured?: boolean;
}
