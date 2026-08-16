import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * The brief history, newest first.
 *
 * `from`/`to` are matched against `briefDate`, which is a calendar day in the
 * store's own timezone — so "the first week of Ramadan" means what the owner
 * means by it.
 */
export class BriefQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
