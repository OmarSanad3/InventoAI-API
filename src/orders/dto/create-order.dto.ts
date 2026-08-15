import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod } from '../enums/payment-method.enum';
import {
  CONTACT_PHONE_MAX_LENGTH,
  CONTACT_PHONE_MIN_LENGTH,
  MAX_CUSTOMER_NOTE_LENGTH,
  MAX_ITEM_QUANTITY,
  MAX_ORDER_ITEMS,
} from '../orders.constants';
import { ShippingAddressDto } from './shipping-address.dto';

/**
 * One cart line. It addresses a **variant**, never a product: every product has
 * at least one variant, so there is no fallback to guess which size was meant.
 */
export class OrderItemInputDto {
  @IsUUID()
  variantId!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_ITEM_QUANTITY)
  quantity!: number;
}

/**
 * Note what is **absent**: no prices, no totals, no `storeId`, no `userId`. Any
 * of them is a 400 from `forbidNonWhitelisted`, which is the cheapest possible
 * defence against a client that decides its own totals. Every amount on the
 * resulting order is read from the database at checkout time.
 */
export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ORDER_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items!: OrderItemInputDto[];

  /**
   * `@IsObject()` as well as `@ValidateNested()`: nested validation alone says
   * nothing about a **missing** object, and the checkout would then dereference
   * `undefined` into a 500 where the client deserves a 400.
   */
  @IsObject()
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress!: ShippingAddressDto;

  /** The only contact detail the account cannot supply. */
  @IsString()
  @Length(CONTACT_PHONE_MIN_LENGTH, CONTACT_PHONE_MAX_LENGTH)
  contactPhone!: string;

  @IsOptional()
  @IsString()
  @Length(0, MAX_CUSTOMER_NOTE_LENGTH)
  customerNote?: string;

  /** `cod` is the only method this branch accepts; `card` arrives with payments.md. */
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod = PaymentMethod.Cod;
}
