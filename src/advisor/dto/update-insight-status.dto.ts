import { IsIn } from 'class-validator';
import { AdvisorInsightStatus } from '../enums/advisor-insight-status.enum';

/** What an owner did about a line: ordered the stock, or waved it away. */
export type ActionableInsightStatus =
  AdvisorInsightStatus.Acted | AdvisorInsightStatus.Dismissed;

const ACTIONABLE_STATUSES: readonly ActionableInsightStatus[] = [
  AdvisorInsightStatus.Acted,
  AdvisorInsightStatus.Dismissed,
];

/**
 * `new` is deliberately not accepted.
 *
 * It is the state the writer assigns, not a state an owner returns to — and
 * allowing it back would let a dismissal be undone in a way the suppression
 * window cannot see. An owner who changes their mind waits for tomorrow.
 */
export class UpdateInsightStatusDto {
  @IsIn(ACTIONABLE_STATUSES, {
    message: 'status must be one of: acted, dismissed',
  })
  status!: ActionableInsightStatus;
}
