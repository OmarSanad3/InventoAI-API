import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import type { SortOrder } from '../../common/types/sort-order';
import { SORT_ORDERS } from '../../common/types/sort-order';
import { OrderSort } from '../enums/order-sort.enum';
import { OrderStatus } from '../enums/order-status.enum';
import { PaymentStatus } from '../enums/payment-status.enum';

const SEARCH_MAX_LENGTH = 200;

/** Filters for the dashboard's order list. */
export class OrderQueryDto extends PaginationQueryDto {
  /**
   * An order number (`1042` or `#1042`), or part of the buyer's name or email.
   * The owner is looking for a row they know exists, so this is a prefix-free
   * `ILIKE` rather than the catalog's full-text stack.
   */
  @IsOptional()
  @IsString()
  @Length(0, SEARCH_MAX_LENGTH)
  search?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  /** Inclusive, on `createdAt`. */
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  @IsOptional()
  @IsEnum(OrderSort)
  sort: OrderSort = OrderSort.CreatedAt;

  @IsOptional()
  @IsIn(SORT_ORDERS)
  order: SortOrder = 'DESC';
}
