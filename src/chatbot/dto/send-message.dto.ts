import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import {
  CHATBOT_MESSAGE_MAX_LENGTH,
  CHATBOT_MESSAGE_MIN_LENGTH,
} from '../chatbot.constants';

export class SendMessageDto {
  @IsString()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(CHATBOT_MESSAGE_MIN_LENGTH, CHATBOT_MESSAGE_MAX_LENGTH)
  message!: string;

  /**
   * Absent on the first message of a conversation; the reply carries the id the
   * server issued. An unknown or foreign one is a 404, never a silent new
   * session — the client would otherwise lose a conversation without being told.
   */
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
