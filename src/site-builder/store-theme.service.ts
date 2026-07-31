import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Repository } from 'typeorm';
import { GeminiService } from '../ai/gemini.service';
import { GeneratedThemeDto } from './dto/generated-theme.dto';
import { PaletteDto } from './dto/palette.dto';
import { StoreTheme } from './entities/store-theme.entity';
import { Store } from './entities/store.entity';
import {
  buildGenerateThemesPrompt,
  GENERATE_THEMES_SCHEMA,
} from './prompts/generate-themes.prompt';
import {
  MAX_GENERATION_ATTEMPTS,
  MAX_HERO_HEADLINE_LENGTH,
  MAX_HERO_SUBTITLE_LENGTH,
  MAX_STORE_DESCRIPTION_LENGTH,
  MIN_VALID_THEMES,
} from './site-builder.constants';
import { QuestionAnswer } from './types/question-answer';
import { Palette, PALETTE_KEYS } from './types/theme';

export interface GenerateThemesCommand {
  readonly store: Store;
  readonly answers: readonly QuestionAnswer[];
  readonly hasLogo: boolean;
}

/** Everything one Gemini call produces: the copy and the themes. */
export interface GeneratedBranding {
  readonly themes: StoreTheme[];
  readonly storeDescription: string | null;
  readonly heroHeadline: string | null;
  readonly heroSubtitle: string | null;
}

interface BrandingPayload {
  readonly themes: GeneratedThemeDto[];
  readonly storeDescription: string | null;
  readonly heroHeadline: string | null;
  readonly heroSubtitle: string | null;
}

/** Owns `StoreTheme`: generating a batch, listing it, and selecting one. */
@Injectable()
export class StoreThemeService {
  private readonly logger = new Logger(StoreThemeService.name);

  constructor(
    @InjectRepository(StoreTheme)
    private readonly themeRepository: Repository<StoreTheme>,
    private readonly geminiService: GeminiService,
  ) {}

  /**
   * Asks Gemini for the store description and a batch of themes, drops the
   * themes that fail validation and persists the rest as a new generation.
   */
  async generateForStore(
    command: GenerateThemesCommand,
  ): Promise<GeneratedBranding> {
    const generated = await this.requestBranding(command);
    const generation = (await this.findLatestGeneration(command.store.id)) + 1;

    const themes = generated.themes.map((theme) =>
      this.themeRepository.create({
        storeId: command.store.id,
        name: theme.name,
        description: theme.description,
        style: theme.style,
        font: theme.font,
        radius: theme.radius,
        light: toPalette(theme.light),
        dark: toPalette(theme.dark),
        isSelected: false,
        generation,
      }),
    );
    return {
      themes: await this.themeRepository.save(themes),
      storeDescription: generated.storeDescription,
      heroHeadline: generated.heroHeadline,
      heroSubtitle: generated.heroSubtitle,
    };
  }

  /** Newest batch first, stable within a batch. */
  async listForStore(storeId: string): Promise<StoreTheme[]> {
    return this.themeRepository.find({
      where: { storeId },
      order: { generation: 'DESC', createdAt: 'ASC' },
    });
  }

  async selectTheme(storeId: string, themeId: string): Promise<StoreTheme> {
    const theme = await this.themeRepository.findOne({
      where: { id: themeId, storeId },
    });
    if (!theme) {
      throw new NotFoundException('Theme not found');
    }

    await this.themeRepository.update({ storeId }, { isSelected: false });
    theme.isSelected = true;
    return this.themeRepository.save(theme);
  }

  private async requestBranding({
    store,
    answers,
    hasLogo,
  }: GenerateThemesCommand): Promise<BrandingPayload> {
    const prompt = buildGenerateThemesPrompt({
      businessName: store.name,
      answers,
      hasLogo,
    });

    this.logger.debug(prompt);

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      const payload = await this.geminiService.generateJson<{
        themes?: unknown;
        storeDescription?: unknown;
        heroHeadline?: unknown;
        heroSubtitle?: unknown;
      }>({ prompt, schema: GENERATE_THEMES_SCHEMA });

      const themes = this.keepValidThemes(payload.themes);
      if (themes.length >= MIN_VALID_THEMES) {
        return {
          themes,
          storeDescription: toText(
            payload.storeDescription,
            MAX_STORE_DESCRIPTION_LENGTH,
          ),
          heroHeadline: toText(payload.heroHeadline, MAX_HERO_HEADLINE_LENGTH),
          heroSubtitle: toText(payload.heroSubtitle, MAX_HERO_SUBTITLE_LENGTH),
        };
      }
      this.logger.warn(
        `Theme generation attempt ${attempt} for store ${store.id} yielded ${themes.length} valid themes`,
      );
    }

    throw new ServiceUnavailableException(
      'Could not generate themes right now, please try again',
    );
  }

  private keepValidThemes(themes: unknown): GeneratedThemeDto[] {
    if (!Array.isArray(themes)) {
      return [];
    }
    return themes
      .map((theme) => plainToInstance(GeneratedThemeDto, theme))
      .filter((theme) => validateSync(theme).length === 0);
  }

  private async findLatestGeneration(storeId: string): Promise<number> {
    const latest = await this.themeRepository.findOne({
      where: { storeId },
      order: { generation: 'DESC' },
      select: { generation: true },
    });
    return latest?.generation ?? 0;
  }
}

/** Keeps a generated string only when the model actually wrote one. */
function toText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed.length > 0 ? trimmed : null;
}

/** Rebuilds the palette from the known keys so no stray AI field is stored. */
function toPalette(palette: PaletteDto): Palette {
  return Object.fromEntries(
    PALETTE_KEYS.map((key) => [key, palette[key]]),
  ) as Palette;
}
