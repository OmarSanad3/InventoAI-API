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
  ValidateIf,
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
 * Every field optional — the dashboard edits one at a time — and the two
 * nullable ones accept an explicit `null` to clear, which `@IsOptional()`
 * alone would reject.
 */
export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @Length(SUPPLIER_NAME_MIN_LENGTH, SUPPLIER_NAME_MAX_LENGTH)
  name?: string;

  /** Trimmed before validation, for the reason `CreateSupplierDto` explains. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsOptional()
  @IsEmail()
  @MaxLength(SUPPLIER_EMAIL_MAX_LENGTH)
  contactEmail?: string;

  @ValidateIf((dto: UpdateSupplierDto) => dto.phone !== null)
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_PHONE_MAX_LENGTH)
  phone?: string | null;

  @IsOptional()
  @IsInt()
  @Min(MIN_LEAD_TIME_DAYS)
  @Max(MAX_LEAD_TIME_DAYS)
  leadTimeDays?: number;

  @ValidateIf((dto: UpdateSupplierDto) => dto.notes !== null)
  @IsOptional()
  @IsString()
  @MaxLength(SUPPLIER_NOTES_MAX_LENGTH)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
