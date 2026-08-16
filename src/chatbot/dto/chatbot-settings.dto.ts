import { Store } from '../../site-builder/entities/store.entity';
import { buildDefaultGreeting } from '../chatbot.constants';
import { ChatbotSettings } from '../entities/chatbot-settings.entity';
import { ChatbotTone } from '../enums/chatbot-tone.enum';

/**
 * The owner's view of their assistant's switches.
 *
 * `greeting` is returned as stored — `null` when the owner has never written
 * one — while `effectiveGreeting` is what the widget will actually show. The
 * editor needs the first so it does not save a default the owner never chose,
 * exactly as `StoreHeroDto` splits `ctaHref`.
 */
export class ChatbotSettingsDto {
  isEnabled!: boolean;
  greeting!: string | null;
  effectiveGreeting!: string;
  tone!: ChatbotTone;
  contactEmail!: string | null;
  updatedAt!: Date;

  static fromEntity(
    settings: ChatbotSettings,
    store: Store,
  ): ChatbotSettingsDto {
    const dto = new ChatbotSettingsDto();
    dto.isEnabled = settings.isEnabled;
    dto.greeting = settings.greeting;
    dto.effectiveGreeting =
      settings.greeting ?? buildDefaultGreeting(store.name);
    dto.tone = settings.tone;
    dto.contactEmail = settings.contactEmail;
    dto.updatedAt = settings.updatedAt;
    return dto;
  }
}

/**
 * What the storefront widget needs before a conversation exists: whether to
 * render itself at all, and the bubble to open with.
 *
 * `tone` and `contactEmail` are deliberately absent — the first is an
 * instruction to the model and the second is offered by the assistant in its
 * own words, so neither is the client's to render.
 */
export class PublicChatbotSettingsDto {
  isEnabled!: boolean;
  greeting!: string;

  static fromEntity(
    settings: ChatbotSettings,
    store: Store,
  ): PublicChatbotSettingsDto {
    const dto = new PublicChatbotSettingsDto();
    dto.isEnabled = settings.isEnabled;
    dto.greeting = settings.greeting ?? buildDefaultGreeting(store.name);
    return dto;
  }
}
