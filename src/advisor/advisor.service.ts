import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { RedisService } from '../redis/redis.service';
import { StoreService } from '../site-builder/store.service';
import {
  ADVISOR_GENERATE_COOLDOWN_KEY_PREFIX,
  ADVISOR_GENERATE_COOLDOWN_SECONDS,
} from './advisor.constants';
import { AdvisorBriefService } from './advisor-brief.service';
import { AdvisorSettingsService } from './advisor-settings.service';
import {
  AdvisorBriefDetailDto,
  AdvisorBriefSummaryDto,
  LatestBriefDto,
} from './dto/advisor-brief.dto';
import { AdvisorInsightDto } from './dto/advisor-insight.dto';
import { BriefQueryDto } from './dto/brief-query.dto';
import { UpdateInsightStatusDto } from './dto/update-insight-status.dto';
import { AdvisorBrief } from './entities/advisor-brief.entity';
import { AdvisorInsight } from './entities/advisor-insight.entity';
import { AdvisorGenerator } from './enums/advisor-generator.enum';
import { getLocalDateString } from './utils/timezone.util';

/** Marks the cooldown; the value is never read, only its TTL. */
const COOLDOWN_MARKER = '1';

/**
 * The dashboard's half: reading briefs, acting on a line, and the "run it now"
 * button.
 *
 * Every method resolves the caller's store first and scopes its query by that
 * id, so another store's brief is invisible rather than forbidden — a 403 would
 * confirm the id exists.
 */
@Injectable()
export class AdvisorService {
  constructor(
    @InjectRepository(AdvisorBrief)
    private readonly briefRepository: Repository<AdvisorBrief>,
    @InjectRepository(AdvisorInsight)
    private readonly insightRepository: Repository<AdvisorInsight>,
    private readonly briefService: AdvisorBriefService,
    private readonly settingsService: AdvisorSettingsService,
    private readonly storeService: StoreService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * The panel's read: the newest brief, whenever it was written.
   *
   * A store with none gets `brief: null` and a 200. An empty panel is a state —
   * "your first brief arrives tomorrow morning" — and a 404 would make the
   * dashboard render an error for a store that has simply not woken up yet.
   */
  async getLatest(user: JwtPayload): Promise<LatestBriefDto> {
    const store = await this.storeService.resolveCallerStore(user);
    const brief = await this.briefRepository.findOne({
      where: { storeId: store.id },
      relations: { insights: true },
      order: { briefDate: 'DESC' },
    });

    const settings = await this.settingsService.resolveForStore(store.id);
    const timezone = this.settingsService.resolveTimezone(settings);

    return LatestBriefDto.fromEntity(
      brief,
      getLocalDateString(new Date(), timezone),
    );
  }

  async list(
    user: JwtPayload,
    query: BriefQueryDto,
  ): Promise<PaginatedResponseDto<AdvisorBriefSummaryDto>> {
    const store = await this.storeService.resolveCallerStore(user);

    const [briefs, total] = await this.briefRepository.findAndCount({
      where: {
        storeId: store.id,
        ...buildDateFilter(query),
      },
      order: { briefDate: 'DESC' },
      skip: query.offset,
      take: query.limit,
    });

    return PaginatedResponseDto.of(
      briefs.map((brief) => AdvisorBriefSummaryDto.fromEntity(brief)),
      total,
      query,
    );
  }

  async getById(user: JwtPayload, id: string): Promise<AdvisorBriefDetailDto> {
    const store = await this.storeService.resolveCallerStore(user);
    const brief = await this.briefRepository.findOne({
      where: { id, storeId: store.id },
      relations: { insights: true },
    });
    if (!brief) {
      throw new NotFoundException('Brief not found');
    }

    return AdvisorBriefDetailDto.fromEntity(brief);
  }

  /**
   * The "run it now" button.
   *
   * It writes `generatedBy: manual`, replaces today's brief, and sends no
   * email — the owner is already looking at the screen it appears on.
   *
   * It runs even when `isEnabled` is false, which is deliberate: the switch
   * turns off the *schedule*, and an owner who pressed the button has asked.
   */
  async generateNow(user: JwtPayload): Promise<LatestBriefDto> {
    const store = await this.storeService.resolveCallerStore(user);
    await this.enforceCooldown(store.id);

    const settings = await this.settingsService.resolveForStore(store.id);
    const timezone = this.settingsService.resolveTimezone(settings);

    try {
      const brief = await this.briefService.generateForStore({
        store,
        generatedBy: AdvisorGenerator.Manual,
      });

      // `null` means the collectors found nothing worth saying. That is a 200
      // with an empty panel, not an error: a store with nothing wrong is not a
      // failure to generate.
      return LatestBriefDto.fromEntity(
        brief,
        getLocalDateString(new Date(), timezone),
      );
    } catch (err) {
      // The owner got nothing, so they should not have to wait to try again.
      await this.redisService.del(this.cooldownKey(store.id));
      throw err;
    }
  }

  /** Marks a line acted on or dismissed. Both suppress it for a week. */
  async updateInsightStatus(
    user: JwtPayload,
    id: string,
    dto: UpdateInsightStatusDto,
  ): Promise<AdvisorInsightDto> {
    const store = await this.storeService.resolveCallerStore(user);
    const insight = await this.insightRepository.findOne({
      where: { id, storeId: store.id },
    });
    if (!insight) {
      throw new NotFoundException('Insight not found');
    }

    insight.status = dto.status;
    // The clock the suppression window is measured from, so re-dismissing an
    // old line genuinely restarts it.
    insight.statusChangedAt = new Date();

    const saved = await this.insightRepository.save(insight);
    return AdvisorInsightDto.fromEntity(saved);
  }

  /**
   * Rejects a second generation inside the window, then opens a new one. Set
   * *before* the call, like the catalog generation's: it guards the Gemini bill
   * against an impatient owner, so it cannot wait for the answer.
   */
  private async enforceCooldown(storeId: string): Promise<void> {
    const key = this.cooldownKey(storeId);
    const remaining = await this.redisService.ttl(key);
    if (remaining > 0) {
      throw new HttpException(
        `A brief was generated moments ago, please wait ${remaining} seconds before generating another`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.redisService.setex(
      key,
      ADVISOR_GENERATE_COOLDOWN_SECONDS,
      COOLDOWN_MARKER,
    );
  }

  private cooldownKey(storeId: string): string {
    return `${ADVISOR_GENERATE_COOLDOWN_KEY_PREFIX}${storeId}`;
  }
}

/** `briefDate` is a calendar day, so the filter compares `YYYY-MM-DD` strings. */
function buildDateFilter({ from, to }: BriefQueryDto) {
  const asDate = (value: Date): string => value.toISOString().slice(0, 10);

  if (from && to) {
    return { briefDate: Between(asDate(from), asDate(to)) };
  }
  if (from) {
    return { briefDate: MoreThanOrEqual(asDate(from)) };
  }
  if (to) {
    return { briefDate: LessThanOrEqual(asDate(to)) };
  }
  return {};
}
