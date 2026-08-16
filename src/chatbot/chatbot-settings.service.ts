import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { Store } from '../site-builder/entities/store.entity';
import { StoreService } from '../site-builder/store.service';
import { ChatbotSettingsDto } from './dto/chatbot-settings.dto';
import { UpdateChatbotSettingsDto } from './dto/update-chatbot-settings.dto';
import { ChatbotSettings } from './entities/chatbot-settings.entity';
import { ChatbotTone } from './enums/chatbot-tone.enum';

/**
 * The per-store switches, and the one lookup the storefront's chat path makes
 * before anything else.
 *
 * A store with no row has never opened the chatbot page, and that reads as the
 * defaults — so the read path never writes. The row is created only when an
 * owner actually looks at the settings, which is the "lazily on first read" the
 * spec asks for, narrowed to the read that is theirs.
 */
@Injectable()
export class ChatbotSettingsService {
  constructor(
    @InjectRepository(ChatbotSettings)
    private readonly settingsRepository: Repository<ChatbotSettings>,
    private readonly storeService: StoreService,
  ) {}

  /** The dashboard's read. Creates the row so the editor has an `updatedAt`. */
  async getForCaller(user: JwtPayload): Promise<ChatbotSettingsDto> {
    const store = await this.storeService.resolveCallerStore(user);
    const settings = await this.loadOrCreate(store.id);
    return ChatbotSettingsDto.fromEntity(settings, store);
  }

  async update(
    user: JwtPayload,
    dto: UpdateChatbotSettingsDto,
  ): Promise<ChatbotSettingsDto> {
    const store = await this.storeService.resolveCallerStore(user);
    const settings = await this.loadOrCreate(store.id);

    if (dto.isEnabled !== undefined) {
      settings.isEnabled = dto.isEnabled;
    }
    if (dto.greeting !== undefined) {
      settings.greeting = dto.greeting?.trim() || null;
    }
    if (dto.tone !== undefined) {
      settings.tone = dto.tone;
    }
    if (dto.contactEmail !== undefined) {
      settings.contactEmail = dto.contactEmail?.trim().toLowerCase() || null;
    }

    const saved = await this.settingsRepository.save(settings);
    return ChatbotSettingsDto.fromEntity(saved, store);
  }

  /**
   * The storefront's read, and the chat turn's.
   *
   * Deliberately never writes: a shopper's first message must not create a row,
   * or an anonymous flood would write one per store it touched.
   */
  async resolveForStore(store: Store): Promise<ChatbotSettings> {
    const settings = await this.settingsRepository.findOne({
      where: { storeId: store.id },
    });
    return settings ?? this.buildDefaults(store.id);
  }

  private async loadOrCreate(storeId: string): Promise<ChatbotSettings> {
    const existing = await this.settingsRepository.findOne({
      where: { storeId },
    });
    if (existing) {
      return existing;
    }
    return this.settingsRepository.save(this.buildDefaults(storeId));
  }

  /** An unsaved row carrying exactly the column defaults, for the read path. */
  private buildDefaults(storeId: string): ChatbotSettings {
    return this.settingsRepository.create({
      storeId,
      isEnabled: true,
      greeting: null,
      tone: ChatbotTone.Friendly,
      contactEmail: null,
    });
  }
}
