import { ChatResolution } from '../enums/chat-resolution.enum';

/** How often the assistant put a given product in front of a shopper. */
export class ChatProductMentionDto {
  productId!: string;
  title!: string;
  slug!: string;
  occurrences!: number;
}

/**
 * Counts over a window, and nothing beyond counts.
 *
 * No funnels, no cohorts and no per-day series — those are the Advisor's
 * problem, and a chart endpoint invented before anyone has read this one is a
 * shape the dashboard would have to live with.
 */
export class ChatStatsDto {
  days!: number;
  from!: Date;
  sessions!: number;
  /** Both halves of every exchange, so it is roughly twice the turn count. */
  messages!: number;
  /** Turns the shopper started; the assistant's replies are counted separately. */
  questions!: number;
  /** One key per `ChatResolution`, zero-filled, so a client can render a bar per state. */
  byResolution!: Record<ChatResolution, number>;
  /** Themes the assistant could not answer, in the same window. */
  unansweredThemes!: number;
  topProducts!: ChatProductMentionDto[];
}
