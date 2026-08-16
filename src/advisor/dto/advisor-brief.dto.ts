import { AdvisorBrief } from '../entities/advisor-brief.entity';
import { AdvisorGenerator } from '../enums/advisor-generator.enum';
import { NarratorStatus } from '../enums/narrator-status.enum';
import { AdvisorInsightDto } from './advisor-insight.dto';

/** A row of the history list: enough to render a date and a headline. */
export class AdvisorBriefSummaryDto {
  id!: string;
  briefDate!: string;
  headline!: string;
  insightCount!: number;
  generatedBy!: AdvisorGenerator;
  narratorStatus!: NarratorStatus;
  emailedAt!: Date | null;
  createdAt!: Date;

  static fromEntity(brief: AdvisorBrief): AdvisorBriefSummaryDto {
    const dto = new AdvisorBriefSummaryDto();
    dto.id = brief.id;
    dto.briefDate = brief.briefDate;
    dto.headline = brief.headline;
    dto.insightCount = brief.insightCount;
    dto.generatedBy = brief.generatedBy;
    dto.narratorStatus = brief.narratorStatus;
    dto.emailedAt = brief.emailedAt;
    dto.createdAt = brief.createdAt;
    return dto;
  }
}

/**
 * The brief itself.
 *
 * `extends` rather than a copy, and the direction is the safe one: a field
 * added to the summary appears here too, and a field added here can never leak
 * into the list — the same call `OrderDetailDto` made.
 */
export class AdvisorBriefDetailDto extends AdvisorBriefSummaryDto {
  insights!: AdvisorInsightDto[];

  static fromEntity(brief: AdvisorBrief): AdvisorBriefDetailDto {
    const dto = Object.assign(
      new AdvisorBriefDetailDto(),
      AdvisorBriefSummaryDto.fromEntity(brief),
    );
    dto.insights = [...(brief.insights ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((insight) => AdvisorInsightDto.fromEntity(insight));
    return dto;
  }
}

/**
 * What `GET /advisor/brief` answers with — including when there is nothing.
 *
 * An empty dashboard panel is a **state**, not an error: a store whose first
 * brief has not been written yet gets `brief: null` and a 200, so the panel can
 * say "your first brief arrives tomorrow morning" rather than render a 404.
 */
export class LatestBriefDto {
  brief!: AdvisorBriefDetailDto | null;
  /** True when the newest brief is not today's, so the panel can date it. */
  isStale!: boolean;

  static fromEntity(
    brief: AdvisorBrief | null,
    todayLocalDate: string,
  ): LatestBriefDto {
    const dto = new LatestBriefDto();
    dto.brief = brief ? AdvisorBriefDetailDto.fromEntity(brief) : null;
    dto.isStale = brief !== null && brief.briefDate !== todayLocalDate;
    return dto;
  }
}
