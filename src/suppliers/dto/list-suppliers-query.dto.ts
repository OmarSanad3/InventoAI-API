import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../common/transformers/to-boolean.transformer';
import { SUPPLIER_NAME_MAX_LENGTH } from '../suppliers.constants';

/** `search` is `ILIKE` over the name and the email — an owner looking for a
 *  supplier knows who they are looking for. */
export class ListSuppliersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_NAME_MAX_LENGTH)
  search?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}
