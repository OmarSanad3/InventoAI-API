import { ChatMessage } from '../entities/chat-message.entity';
import { ChatSession } from '../entities/chat-session.entity';
import { ChatResolution } from '../enums/chat-resolution.enum';
import { ChatRole } from '../enums/chat-role.enum';

export class TranscriptMessageDto {
  id!: string;
  role!: ChatRole;
  text!: string;
  resolution!: ChatResolution | null;
  createdAt!: Date;

  static fromEntity(message: ChatMessage): TranscriptMessageDto {
    const dto = new TranscriptMessageDto();
    dto.id = message.id;
    dto.role = message.role;
    dto.text = message.text;
    dto.resolution = message.resolution;
    dto.createdAt = message.createdAt;
    return dto;
  }
}

/**
 * A conversation as the widget re-renders it after a reload.
 *
 * `sources` and `latencyMs` are deliberately absent — they are the owner's
 * diagnostics and belong to the dashboard, not to the shopper's own view.
 */
export class ChatTranscriptDto {
  sessionId!: string;
  isSignedIn!: boolean;
  messages!: TranscriptMessageDto[];

  static fromEntities(
    session: ChatSession,
    messages: readonly ChatMessage[],
  ): ChatTranscriptDto {
    const dto = new ChatTranscriptDto();
    dto.sessionId = session.id;
    dto.isSignedIn = session.userId !== null;
    dto.messages = messages.map((message) =>
      TranscriptMessageDto.fromEntity(message),
    );
    return dto;
  }
}
