import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';
import {
  ADDRESS_CITY_MAX_LENGTH,
  ADDRESS_COUNTRY_LENGTH,
  ADDRESS_GOVERNORATE_MAX_LENGTH,
  ADDRESS_LINE_MAX_LENGTH,
  ADDRESS_POSTAL_CODE_MAX_LENGTH,
} from '../orders.constants';
import type { ShippingAddress } from '../types/shipping-address';

/** Treats an omitted or blank optional line as absent rather than as `""`. */
function toNullableText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Where the order goes. Deliberately loose about what a "governorate" or a
 * postal code looks like: the platform targets Egypt and MENA first but must not
 * reject an address it simply does not recognise.
 */
export class ShippingAddressDto {
  @IsString()
  @Length(1, ADDRESS_LINE_MAX_LENGTH)
  line1!: string;

  @IsOptional()
  @IsString()
  @Length(0, ADDRESS_LINE_MAX_LENGTH)
  line2?: string;

  @IsString()
  @Length(1, ADDRESS_CITY_MAX_LENGTH)
  city!: string;

  @IsOptional()
  @IsString()
  @Length(0, ADDRESS_GOVERNORATE_MAX_LENGTH)
  governorate?: string;

  @IsOptional()
  @IsString()
  @Length(0, ADDRESS_POSTAL_CODE_MAX_LENGTH)
  postalCode?: string;

  /** ISO 3166-1 alpha-2. Uppercased here so `eg` and `EG` are one country. */
  @Transform(({ value }: { value: unknown }): unknown =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(ADDRESS_COUNTRY_LENGTH, ADDRESS_COUNTRY_LENGTH)
  country!: string;

  /** The snapshot actually stored on the order. */
  toShippingAddress(): ShippingAddress {
    return {
      line1: this.line1.trim(),
      line2: toNullableText(this.line2),
      city: this.city.trim(),
      governorate: toNullableText(this.governorate),
      postalCode: toNullableText(this.postalCode),
      country: this.country,
    };
  }
}
