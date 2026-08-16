import { AdvisorSettings } from '../entities/advisor-settings.entity';

/**
 * The owner's view of their Advisor configuration.
 *
 * `timezone` is returned as stored — `null` when the owner has never chosen one
 * — beside `effectiveTimezone`, which is what the scheduler will actually use.
 * The editor needs the first so it cannot save a default nobody picked; the
 * "when will this arrive" line needs the second. The same split
 * `ChatbotSettingsDto` makes for `greeting`.
 */
export class AdvisorSettingsDto {
  isEnabled!: boolean;
  emailEnabled!: boolean;
  sendHour!: number;
  timezone!: string | null;
  effectiveTimezone!: string;
  countryCode!: string | null;
  city!: string | null;
  latitude!: number | null;
  longitude!: number | null;
  /** False means no weather section, and no outbound request either. */
  hasWeatherLocation!: boolean;
  leadTimeDays!: number;
  updatedAt!: Date;

  static fromEntity(
    settings: AdvisorSettings,
    defaultTimezone: string,
  ): AdvisorSettingsDto {
    const dto = new AdvisorSettingsDto();
    dto.isEnabled = settings.isEnabled;
    dto.emailEnabled = settings.emailEnabled;
    dto.sendHour = settings.sendHour;
    dto.timezone = settings.timezone;
    dto.effectiveTimezone = settings.timezone ?? defaultTimezone;
    dto.countryCode = settings.countryCode;
    dto.city = settings.city;
    dto.latitude = settings.latitude;
    dto.longitude = settings.longitude;
    dto.hasWeatherLocation =
      settings.latitude !== null && settings.longitude !== null;
    dto.leadTimeDays = settings.leadTimeDays;
    dto.updatedAt = settings.updatedAt;
    return dto;
  }
}
