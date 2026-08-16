import { AdvisorInsight } from '../entities/advisor-insight.entity';
import { AdvisorInsightKind } from '../enums/advisor-insight-kind.enum';
import { AdvisorInsightStatus } from '../enums/advisor-insight-status.enum';
import { AdvisorSeverity } from '../enums/advisor-severity.enum';

/**
 * One line of the brief as the dashboard renders it.
 *
 * `payload` goes out whole and unformatted — money in minor units, ids that
 * link somewhere — so the panel can render a number the way it renders every
 * other number in the product rather than parsing it back out of `body`.
 */
export class AdvisorInsightDto {
  id!: string;
  kind!: AdvisorInsightKind;
  severity!: AdvisorSeverity;
  title!: string;
  body!: string;
  payload!: Record<string, unknown>;
  status!: AdvisorInsightStatus;
  statusChangedAt!: Date | null;
  position!: number;

  static fromEntity(insight: AdvisorInsight): AdvisorInsightDto {
    const dto = new AdvisorInsightDto();
    dto.id = insight.id;
    dto.kind = insight.kind;
    dto.severity = insight.severity;
    dto.title = insight.title;
    dto.body = insight.body;
    dto.payload = insight.payload;
    dto.status = insight.status;
    dto.statusChangedAt = insight.statusChangedAt;
    dto.position = insight.position;
    return dto;
  }
}
