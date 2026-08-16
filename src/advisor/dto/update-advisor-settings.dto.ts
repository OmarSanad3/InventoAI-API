import {
  IsBoolean,
  IsInt,
  IsISO31661Alpha2,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsTimeZone,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  ADVISOR_CITY_MAX_LENGTH,
  ADVISOR_TIMEZONE_MAX_LENGTH,
  MAX_LEAD_TIME_DAYS,
  MAX_SEND_HOUR,
  MIN_SEND_HOUR,
} from '../advisor.constants';

const CITY_MIN_LENGTH = 1;

/**
 * Every field is optional — the dashboard patches one switch at a time — and
 * the nullable ones accept an explicit `null` to clear, which `@IsOptional()`
 * alone would reject.
 *
 * `latitude`/`longitude` are bounded here but their **both-or-neither** rule is
 * not: this is a PATCH, so whether the store ends up with a usable pair depends
 * on the row as much as on the body. That check lives in the service, where the
 * merged result is known, and is a 400 all the same.
 */
export class UpdateAdvisorSettingsDto {
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(MIN_SEND_HOUR)
  @Max(MAX_SEND_HOUR)
  sendHour?: number;

  /**
   * Checked with `@IsTimeZone()`, which asks `Intl` rather than a regex — the
   * same `Intl` that will consume the value when the scheduler asks what hour
   * it is in this store.
   */
  @ValidateIf((dto: UpdateAdvisorSettingsDto) => dto.timezone !== null)
  @IsOptional()
  @IsString()
  @MaxLength(ADVISOR_TIMEZONE_MAX_LENGTH)
  @IsTimeZone()
  timezone?: string | null;

  @ValidateIf((dto: UpdateAdvisorSettingsDto) => dto.countryCode !== null)
  @IsOptional()
  @IsISO31661Alpha2()
  countryCode?: string | null;

  @ValidateIf((dto: UpdateAdvisorSettingsDto) => dto.city !== null)
  @IsOptional()
  @IsString()
  @Length(CITY_MIN_LENGTH, ADVISOR_CITY_MAX_LENGTH)
  city?: string | null;

  @ValidateIf((dto: UpdateAdvisorSettingsDto) => dto.latitude !== null)
  @IsOptional()
  @IsLatitude()
  latitude?: number | null;

  @ValidateIf((dto: UpdateAdvisorSettingsDto) => dto.longitude !== null)
  @IsOptional()
  @IsLongitude()
  longitude?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_LEAD_TIME_DAYS)
  leadTimeDays?: number;
}
