import {
  ChatMessage,
  ChatMessageSources,
} from '../entities/chat-message.entity';
import { ChatSession } from '../entities/chat-session.entity';
import { ChatResolution } from '../enums/chat-resolution.enum';
import { ChatRole } from '../enums/chat-role.enum';

/**
 * One bubble, as the **owner** reads it.
 *
 * Unlike the shopper's `TranscriptMessageDto` this carries `sources` and
 * `latencyMs`: they are the owner's diagnostics — which product the assistant
 * put in front of a customer, and how long they waited for it.
 */
export class ChatSessionMessageDto {
  id!: string;
  role!: ChatRole;
  text!: string;
  resolution!: ChatResolution | null;
  sources!: ChatMessageSources | null;
  latencyMs!: number | null;
  reviewedAt!: Date | null;
  createdAt!: Date;

  static fromEntity(message: ChatMessage): ChatSessionMessageDto {
    const dto = new ChatSessionMessageDto();
    dto.id = message.id;
    dto.role = message.role;
    dto.text = message.text;
    dto.resolution = message.resolution;
    dto.sources = message.sources;
    dto.latencyMs = message.latencyMs;
    dto.reviewedAt = message.reviewedAt;
    dto.createdAt = message.createdAt;
    return dto;
  }
}

/**
 * A whole conversation for the dashboard.
 *
 * Named apart from branch 2's `ChatTranscriptDto` rather than replacing it, and
 * deliberately not extending it either: the shopper's view must never grow a
 * field by accident, and two unrelated DTOs are how that stays true.
 */
export class ChatSessionDetailDto {
  id!: string;
  isSignedIn!: boolean;
  customerName!: string | null;
  customerEmail!: string | null;
  messageCount!: number;
  lastMessageAt!: Date | null;
  createdAt!: Date;
  messages!: ChatSessionMessageDto[];

  static fromEntities(
    session: ChatSession,
    messages: readonly ChatMessage[],
  ): ChatSessionDetailDto {
    const dto = new ChatSessionDetailDto();
    dto.id = session.id;
    dto.isSignedIn = session.userId !== null;
    dto.customerName = session.user
      ? `${session.user.firstName} ${session.user.lastName}`
      : null;
    dto.customerEmail = session.user?.email ?? null;
    dto.messageCount = session.messageCount;
    dto.lastMessageAt = session.lastMessageAt;
    dto.createdAt = session.createdAt;
    dto.messages = messages.map((message) =>
      ChatSessionMessageDto.fromEntity(message),
    );
    return dto;
  }
}
