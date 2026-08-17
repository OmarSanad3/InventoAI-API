import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PurchaseRequestStatus } from '../enums/purchase-request-status.enum';

/** Newest first, optionally narrowed to one stage of the machine. */
export class ListPurchaseRequestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PurchaseRequestStatus)
  status?: PurchaseRequestStatus;
}
