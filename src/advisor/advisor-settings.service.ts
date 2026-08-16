import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { EnvironmentVariables } from '../config/env.validation';
import { StoreService } from '../site-builder/store.service';
import {
  ADVISOR_DEFAULT_SEND_HOUR,
  DEFAULT_SUPPLIER_LEAD_TIME_DAYS,
} from './advisor.constants';
import { AdvisorSettingsDto } from './dto/advisor-settings.dto';
import { UpdateAdvisorSettingsDto } from './dto/update-advisor-settings.dto';
import { AdvisorSettings } from './entities/advisor-settings.entity';
import { isValidTimezone } from './utils/timezone.util';

/**
 * The per-store switches, and the row every other part of this module reads
 * before it does anything.
 *
 * The read path deliberately never writes: the scheduler asks for every live
 * store's settings every hour, and a lazily-creating read there would write a
 * row per store on its first night. The row is created only when an owner opens
 * the settings page — the same narrowing `ChatbotSettingsService` makes.
 */
@Injectable()
export class AdvisorSettingsService {
  constructor(
    @InjectRepository(AdvisorSettings)
    private readonly settingsRepository: Repository<AdvisorSettings>,
    private readonly storeService: StoreService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** The platform's fallback zone, for a store that has never chosen one. */
  get defaultTimezone(): string {
    const configured = this.configService.get('ADVISOR_DEFAULT_TIMEZONE', {
      infer: true,
    });
    return isValidTimezone(configured) ? configured : 'UTC';
  }

  /** The dashboard's read. Creates the row so the editor has an `updatedAt`. */
  async getForCaller(user: JwtPayload): Promise<AdvisorSettingsDto> {
    const store = await this.storeService.resolveCallerStore(user);
    const settings = await this.loadOrCreate(store.id);
    return AdvisorSettingsDto.fromEntity(settings, this.defaultTimezone);
  }

  async update(
    user: JwtPayload,
    dto: UpdateAdvisorSettingsDto,
  ): Promise<AdvisorSettingsDto> {
    const store = await this.storeService.resolveCallerStore(user);
    const settings = await this.loadOrCreate(store.id);

    if (dto.isEnabled !== undefined) {
      settings.isEnabled = dto.isEnabled;
    }
    if (dto.emailEnabled !== undefined) {
      settings.emailEnabled = dto.emailEnabled;
    }
    if (dto.sendHour !== undefined) {
      settings.sendHour = dto.sendHour;
    }
    if (dto.timezone !== undefined) {
      settings.timezone = dto.timezone?.trim() || null;
    }
    if (dto.countryCode !== undefined) {
      settings.countryCode = dto.countryCode?.trim().toUpperCase() || null;
    }
    if (dto.city !== undefined) {
      settings.city = dto.city?.trim() || null;
    }
    if (dto.latitude !== undefined) {
      settings.latitude = dto.latitude;
    }
    if (dto.longitude !== undefined) {
      settings.longitude = dto.longitude;
    }
    if (dto.leadTimeDays !== undefined) {
      settings.leadTimeDays = dto.leadTimeDays;
    }

    this.assertCoordinatePair(settings);

    const saved = await this.settingsRepository.save(settings);
    return AdvisorSettingsDto.fromEntity(saved, this.defaultTimezone);
  }

  /**
   * The scheduler's read, and the generator's. Never writes, and answers with
   * an unsaved row of defaults for a store that has none.
   */
  async resolveForStore(storeId: string): Promise<AdvisorSettings> {
    const settings = await this.settingsRepository.findOne({
      where: { storeId },
    });
    return settings ?? this.buildDefaults(storeId);
  }

  /**
   * The zone to run this store's clock in: its own, the platform default, or —
   * if a stored zone has since stopped existing — the platform default again.
   */
  resolveTimezone(settings: AdvisorSettings): string {
    if (settings.timezone && isValidTimezone(settings.timezone)) {
      return settings.timezone;
    }
    return this.defaultTimezone;
  }

  private async loadOrCreate(storeId: string): Promise<AdvisorSettings> {
    const existing = await this.settingsRepository.findOne({
      where: { storeId },
    });
    if (existing) {
      return existing;
    }
    return this.settingsRepository.save(this.buildDefaults(storeId));
  }

  /** An unsaved row carrying exactly the column defaults, for the read path. */
  private buildDefaults(storeId: string): AdvisorSettings {
    return this.settingsRepository.create({
      storeId,
      isEnabled: true,
      emailEnabled: true,
      sendHour: ADVISOR_DEFAULT_SEND_HOUR,
      timezone: null,
      countryCode: null,
      city: null,
      latitude: null,
      longitude: null,
      leadTimeDays: DEFAULT_SUPPLIER_LEAD_TIME_DAYS,
    });
  }

  /**
   * Both or neither. Checked on the **merged** row rather than on the body,
   * because a PATCH that sets only the latitude of a store that already has a
   * longitude is a perfectly good request.
   */
  private assertCoordinatePair(settings: AdvisorSettings): void {
    const hasLatitude = settings.latitude !== null;
    const hasLongitude = settings.longitude !== null;
    if (hasLatitude !== hasLongitude) {
      throw new BadRequestException(
        'latitude and longitude must be set together, or both left empty',
      );
    }
  }
}
