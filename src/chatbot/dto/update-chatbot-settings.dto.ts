import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  CHATBOT_CONTACT_EMAIL_MAX_LENGTH,
  CHATBOT_GREETING_MAX_LENGTH,
} from '../chatbot.constants';
import { ChatbotTone } from '../enums/chatbot-tone.enum';

const GREETING_MIN_LENGTH = 1;

/**
 * Every field is optional — the dashboard patches one switch at a time — and
 * `greeting` and `contactEmail` accept an explicit `null` to clear back to the
 * default, which `@IsOptional()` alone would reject.
 *
 * There is no `tone` free-text escape hatch and no `systemPrompt`: this text
 * goes into a system prompt, and an owner should not be able to rewrite the
 * assistant's rules from a settings form.
 */
export class UpdateChatbotSettingsDto {
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @ValidateIf((dto: UpdateChatbotSettingsDto) => dto.greeting !== null)
  @IsOptional()
  @IsString()
  @Length(GREETING_MIN_LENGTH, CHATBOT_GREETING_MAX_LENGTH)
  greeting?: string | null;

  @IsOptional()
  @IsEnum(ChatbotTone)
  tone?: ChatbotTone;

  @ValidateIf((dto: UpdateChatbotSettingsDto) => dto.contactEmail !== null)
  @IsOptional()
  @IsEmail()
  @MaxLength(CHATBOT_CONTACT_EMAIL_MAX_LENGTH)
  contactEmail?: string | null;
}
