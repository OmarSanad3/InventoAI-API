import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_LEAD_TIME_DAYS } from '../../advisor/advisor.constants';
import {
  MIN_LEAD_TIME_DAYS,
  SUPPLIER_EMAIL_MAX_LENGTH,
  SUPPLIER_NAME_MAX_LENGTH,
  SUPPLIER_NAME_MIN_LENGTH,
  SUPPLIER_NOTES_MAX_LENGTH,
  SUPPLIER_PHONE_MAX_LENGTH,
} from '../suppliers.constants';

/**
 * There is deliberately no `storeId`: `forbidNonWhitelisted` turns any attempt
 * to send one into a 400, and the store always comes from the JWT.
 */
export class CreateSupplierDto {
  @IsString()
  @Length(SUPPLIER_NAME_MIN_LENGTH, SUPPLIER_NAME_MAX_LENGTH)
  name!: string;

  /**
   * Trimmed **before** validation, not after: a supplier's address is usually
   * pasted out of an email client, and `@IsEmail()` rejects the trailing space
   * that comes with it — a 400 the owner cannot see the cause of.
   */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsEmail()
  @MaxLength(SUPPLIER_EMAIL_MAX_LENGTH)
  contactEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_PHONE_MAX_LENGTH)
  phone?: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_LEAD_TIME_DAYS)
  @Max(MAX_LEAD_TIME_DAYS)
  leadTimeDays?: number;

  /** "They deliver late." The drafting prompt reads it. */
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_NOTES_MAX_LENGTH)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
