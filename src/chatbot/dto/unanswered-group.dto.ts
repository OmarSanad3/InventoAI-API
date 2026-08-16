import { UnansweredGroup } from '../utils/summarize-unanswered.util';

/**
 * One theme the store's shoppers asked for and did not get.
 *
 * This is the demand signal the Daily AI Advisor turns into "45 customers asked
 * the chatbot for wireless earbuds — you don't sell them yet", which is the
 * reason `ChatResolution` is computed in code rather than claimed by the model.
 */
export class UnansweredGroupDto {
  /** Stable within the window; `PATCH .../review` addresses the group by a member id. */
  key!: string;
  label!: string;
  occurrences!: number;
  exampleQuestion!: string;
  lastAskedAt!: Date;
  /** Every message behind the theme — one review marks all of them. */
  messageIds!: string[];
  isReviewed!: boolean;

  static fromGroup(group: UnansweredGroup): UnansweredGroupDto {
    const dto = new UnansweredGroupDto();
    dto.key = group.key;
    dto.label = group.label;
    dto.occurrences = group.occurrences;
    dto.exampleQuestion = group.exampleQuestion;
    dto.lastAskedAt = group.lastAskedAt;
    dto.messageIds = group.messageIds;
    dto.isReviewed = group.isReviewed;
    return dto;
  }
}

/**
 * The shape the Advisor depends on, and the one thing in this module other
 * features are meant to call. Narrower than the DTO on purpose: the Advisor
 * writes a sentence, it does not render a review button.
 */
export interface UnansweredTheme {
  readonly label: string;
  readonly occurrences: number;
  readonly exampleQuestion: string;
  readonly lastAskedAt: Date;
}
