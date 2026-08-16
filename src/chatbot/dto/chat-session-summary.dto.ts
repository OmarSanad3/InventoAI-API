import { ChatSession } from '../entities/chat-session.entity';

/** Everything a row needs that is not on the session itself. */
export interface SessionSummaryExtras {
  readonly preview: string | null;
  readonly unansweredCount: number;
}

/** One row of the dashboard's transcript list. */
export class ChatSessionSummaryDto {
  id!: string;
  isSignedIn!: boolean;
  /** Null for an anonymous conversation, and for a deleted account. */
  customerName!: string | null;
  customerEmail!: string | null;
  messageCount!: number;
  unansweredCount!: number;
  /** The shopper's opening question — what makes a list of ids readable. */
  preview!: string | null;
  lastMessageAt!: Date | null;
  createdAt!: Date;

  static fromEntity(
    session: ChatSession,
    { preview, unansweredCount }: SessionSummaryExtras,
  ): ChatSessionSummaryDto {
    const dto = new ChatSessionSummaryDto();
    dto.id = session.id;
    dto.isSignedIn = session.userId !== null;
    dto.customerName = session.user
      ? `${session.user.firstName} ${session.user.lastName}`
      : null;
    dto.customerEmail = session.user?.email ?? null;
    dto.messageCount = session.messageCount;
    dto.unansweredCount = unansweredCount;
    dto.preview = preview;
    dto.lastMessageAt = session.lastMessageAt;
    dto.createdAt = session.createdAt;
    return dto;
  }
}
