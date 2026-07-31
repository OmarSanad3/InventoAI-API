import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeminiService } from '../ai/gemini.service';
import { CloudinaryService } from '../storage/cloudinary.service';
import {
  BUSINESS_NAME_QUESTION_ID,
  getVisibleQuestions,
  OnboardingQuestion,
} from './constants/onboarding-questions';
import { BrainstormResponseDto } from './dto/brainstorm-response.dto';
import { ConfirmDomainResponseDto } from './dto/confirm-domain-response.dto';
import { PublishSiteResponseDto } from './dto/publish-site-response.dto';
import { QuestionsResponseDto } from './dto/questions-response.dto';
import { SubmitAnswersResponseDto } from './dto/submit-answers-response.dto';
import { ThemesResponseDto } from './dto/theme-response.dto';
import { SiteBuildDraft } from './entities/site-build-draft.entity';
import { StoreTheme } from './entities/store-theme.entity';
import { LogoSource } from './enums/logo-source.enum';
import { SiteBuildStep } from './enums/site-build-step.enum';
import {
  buildPrefillAnswersPrompt,
  buildPrefillAnswersSchema,
} from './prompts/prefill-answers.prompt';
import {
  LOGO_SUBFOLDER,
  MONOGRAM_DELIVERY_FORMAT,
  MONOGRAM_UPLOAD_FORMAT,
  SITE_BUILD_STEP_ORDER,
} from './site-builder.constants';
import { StoreService, StoreLogo } from './store.service';
import { StoreThemeService } from './store-theme.service';
import { QuestionAnswer } from './types/question-answer';
import { buildMonogramSvg } from './utils/monogram.util';
import { sanitizeAnswer } from './utils/sanitize-answer.util';
import { slugify } from './utils/slugify.util';

export interface SaveBrainstormCommand {
  readonly ownerId: string;
  readonly brainstorm: string;
  readonly logo?: Buffer;
}

export interface SubmitAnswersCommand {
  readonly ownerId: string;
  readonly answers: readonly QuestionAnswer[];
}

export interface ConfirmDomainRequest {
  readonly ownerId: string;
  readonly businessName: string;
  readonly domain: string;
}

export interface PublishSiteCommand {
  readonly ownerId: string;
  readonly themeId: string;
}

/**
 * Drives the onboarding flow and owns the `SiteBuildDraft` row. Store and theme
 * persistence is delegated to `StoreService` and `StoreThemeService`.
 */
@Injectable()
export class SiteBuilderService {
  constructor(
    @InjectRepository(SiteBuildDraft)
    private readonly draftRepository: Repository<SiteBuildDraft>,
    private readonly storeService: StoreService,
    private readonly storeThemeService: StoreThemeService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly geminiService: GeminiService,
  ) {}

  getQuestions(): QuestionsResponseDto {
    return QuestionsResponseDto.fromCatalog();
  }

  /**
   * Stores the brainstorm and the optional logo, then asks the AI to pre-fill the
   * questionnaire. The draft is saved *before* the AI call, so a Gemini outage
   * costs the owner nothing but a retry.
   */
  async saveBrainstorm({
    ownerId,
    brainstorm,
    logo,
  }: SaveBrainstormCommand): Promise<BrainstormResponseDto> {
    const draft =
      (await this.findDraft(ownerId)) ??
      this.draftRepository.create({
        ownerId,
        step: SiteBuildStep.Brainstormed,
      });

    draft.brainstorm = brainstorm;
    if (logo) {
      await this.replaceDraftLogo(draft, logo);
    }
    this.advanceStep(draft, SiteBuildStep.Brainstormed);
    const saved = await this.draftRepository.save(draft);

    saved.answers = await this.prefillAnswers(saved);
    await this.draftRepository.save(saved);

    return BrainstormResponseDto.fromAnswers(saved.answers);
  }

  async submitAnswers({
    ownerId,
    answers,
  }: SubmitAnswersCommand): Promise<SubmitAnswersResponseDto> {
    const draft = await this.getDraft(ownerId);
    this.requireStep(draft, SiteBuildStep.Brainstormed);

    const questions = getVisibleQuestions(Boolean(draft.logoUrl));
    this.assertAnswersFitQuestions(answers, questions);

    draft.answers = answers.map(({ questionId, answer }) => ({
      questionId,
      answer,
    }));
    draft.businessName = this.extractBusinessName(answers);
    this.advanceStep(draft, SiteBuildStep.Answered);
    await this.draftRepository.save(draft);

    const suggestedDomain = slugify(draft.businessName);
    const store = await this.storeService.findByOwnerId(ownerId);

    const response = new SubmitAnswersResponseDto();
    response.businessName = draft.businessName;
    response.suggestedDomain = suggestedDomain;
    response.hint = await this.storeService.buildConfusableHint(
      suggestedDomain,
      store?.id,
    );
    return response;
  }

  async confirmDomain({
    ownerId,
    businessName,
    domain,
  }: ConfirmDomainRequest): Promise<ConfirmDomainResponseDto> {
    const draft = await this.getDraft(ownerId);
    this.requireStep(draft, SiteBuildStep.Answered);
    if (draft.step === SiteBuildStep.Published) {
      throw new ConflictException(
        'The domain of a published store cannot be changed',
      );
    }

    const { store, hint } = await this.storeService.confirmDomain({
      ownerId,
      name: businessName,
      slug: domain,
    });

    draft.businessName = businessName;
    draft.slug = store.slug;
    this.advanceStep(draft, SiteBuildStep.DomainConfirmed);
    await this.draftRepository.save(draft);

    const response = new ConfirmDomainResponseDto();
    response.slug = store.slug;
    response.storeUrl = this.storeService.buildStoreUrl(store.slug);
    response.hint = hint;
    return response;
  }

  async generateThemes(ownerId: string): Promise<ThemesResponseDto> {
    const draft = await this.getDraft(ownerId);
    this.requireStep(draft, SiteBuildStep.DomainConfirmed);

    const store = await this.storeService.getByOwnerId(ownerId);
    const { themes, storeDescription, heroHeadline, heroSubtitle } =
      await this.storeThemeService.generateForStore({
        store,
        answers: draft.answers ?? [],
        hasLogo: Boolean(draft.logoUrl),
      });

    draft.description = storeDescription ?? draft.description;
    draft.heroHeadline = heroHeadline ?? draft.heroHeadline;
    draft.heroSubtitle = heroSubtitle ?? draft.heroSubtitle;
    this.advanceStep(draft, SiteBuildStep.Themed);
    await this.draftRepository.save(draft);

    return ThemesResponseDto.fromEntities(themes);
  }

  async listThemes(ownerId: string): Promise<ThemesResponseDto> {
    const store = await this.storeService.getByOwnerId(ownerId);
    const themes = await this.storeThemeService.listForStore(store.id);
    return ThemesResponseDto.fromEntities(themes);
  }

  /** Selects the theme, settles the logo and takes the store live. */
  async publish({
    ownerId,
    themeId,
  }: PublishSiteCommand): Promise<PublishSiteResponseDto> {
    const draft = await this.getDraft(ownerId);
    this.requireStep(draft, SiteBuildStep.Themed);

    const store = await this.storeService.getByOwnerId(ownerId);
    const theme = await this.storeThemeService.selectTheme(store.id, themeId);
    const logo = await this.resolveLogo(draft, theme);

    if (
      store.logoPublicId &&
      store.logoPublicId !== logo.publicId &&
      store.logoSource === LogoSource.Monogram
    ) {
      await this.cloudinaryService.destroyImage(store.logoPublicId);
    }

    const published = await this.storeService.publish({
      store,
      description: draft.description,
      logo,
      hero: { headline: draft.heroHeadline, subtitle: draft.heroSubtitle },
    });

    this.advanceStep(draft, SiteBuildStep.Published);
    await this.draftRepository.save(draft);

    const response = new PublishSiteResponseDto();
    response.slug = published.slug;
    response.status = published.status;
    response.storeUrl = this.storeService.buildStoreUrl(published.slug);
    return response;
  }

  /** The uploaded logo when there is one, otherwise a generated monogram. */
  private async resolveLogo(
    draft: SiteBuildDraft,
    theme: StoreTheme,
  ): Promise<StoreLogo> {
    if (draft.logoUrl && draft.logoPublicId) {
      return {
        url: draft.logoUrl,
        publicId: draft.logoPublicId,
        source: LogoSource.Uploaded,
      };
    }

    const svg = buildMonogramSvg({
      businessName: draft.businessName ?? '',
      background: theme.light.primary,
      foreground: theme.light.primaryForeground,
      font: theme.font,
      radius: theme.radius,
    });
    const uploaded = await this.cloudinaryService.uploadImage({
      buffer: Buffer.from(svg, 'utf8'),
      subfolder: LOGO_SUBFOLDER,
      uploadFormat: MONOGRAM_UPLOAD_FORMAT,
      deliveryFormat: MONOGRAM_DELIVERY_FORMAT,
    });
    return { ...uploaded, source: LogoSource.Monogram };
  }

  private async replaceDraftLogo(
    draft: SiteBuildDraft,
    logo: Buffer,
  ): Promise<void> {
    const previousPublicId = draft.logoPublicId;
    const uploaded = await this.cloudinaryService.uploadImage({
      buffer: logo,
      subfolder: LOGO_SUBFOLDER,
    });
    draft.logoUrl = uploaded.url;
    draft.logoPublicId = uploaded.publicId;

    if (previousPublicId) {
      await this.cloudinaryService.destroyImage(previousPublicId);
    }
  }

  private async prefillAnswers(
    draft: SiteBuildDraft,
  ): Promise<QuestionAnswer[]> {
    const questions = getVisibleQuestions(Boolean(draft.logoUrl));
    const suggested = await this.geminiService.generateJson<
      Record<string, unknown>
    >({
      prompt: buildPrefillAnswersPrompt(draft.brainstorm, questions),
      schema: buildPrefillAnswersSchema(questions),
    });

    return questions.map((question) => ({
      questionId: question.id,
      answer: sanitizeAnswer(question, suggested[question.id]),
    }));
  }

  private assertAnswersFitQuestions(
    answers: readonly QuestionAnswer[],
    questions: readonly OnboardingQuestion[],
  ): void {
    const answered = new Set(answers.map((answer) => answer.questionId));
    if (answered.size !== answers.length) {
      throw new BadRequestException('Each question may only be answered once');
    }

    const visible = new Set(questions.map((question) => question.id));
    const hidden = [...answered].filter((id) => !visible.has(id));
    if (hidden.length > 0) {
      throw new BadRequestException(
        `${hidden.join(', ')} does not apply to this store`,
      );
    }

    const missing = questions
      .filter((question) => question.required && !answered.has(question.id))
      .map((question) => question.id);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing answers for ${missing.join(', ')}`,
      );
    }
  }

  private extractBusinessName(answers: readonly QuestionAnswer[]): string {
    const answer = answers.find(
      (entry) => entry.questionId === BUSINESS_NAME_QUESTION_ID,
    )?.answer;
    if (typeof answer !== 'string' || answer.trim().length === 0) {
      throw new BadRequestException('A business name is required');
    }
    return answer.trim();
  }

  private async findDraft(ownerId: string): Promise<SiteBuildDraft | null> {
    return this.draftRepository.findOne({ where: { ownerId } });
  }

  private async getDraft(ownerId: string): Promise<SiteBuildDraft> {
    const draft = await this.findDraft(ownerId);
    if (!draft) {
      throw new ConflictException(
        'Start by describing your business in the brainstorm step',
      );
    }
    return draft;
  }

  /** Rejects calls that arrive before the step they depend on. */
  private requireStep(draft: SiteBuildDraft, minimum: SiteBuildStep): void {
    if (
      SITE_BUILD_STEP_ORDER.indexOf(draft.step) <
      SITE_BUILD_STEP_ORDER.indexOf(minimum)
    ) {
      throw new ConflictException(
        `This step is not available yet — complete the "${minimum}" step first`,
      );
    }
  }

  /** Progress only ever moves forward, so re-running a step never rewinds it. */
  private advanceStep(draft: SiteBuildDraft, step: SiteBuildStep): void {
    const current = SITE_BUILD_STEP_ORDER.indexOf(draft.step);
    if (current < SITE_BUILD_STEP_ORDER.indexOf(step)) {
      draft.step = step;
    }
  }
}
