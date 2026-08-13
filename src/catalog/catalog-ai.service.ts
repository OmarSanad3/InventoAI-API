import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AI_UNAVAILABLE_MESSAGE, GeminiService } from '../ai/gemini.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { RedisService } from '../redis/redis.service';
import { Store } from '../site-builder/entities/store.entity';
import { SiteBuilderService } from '../site-builder/site-builder.service';
import { StoreService } from '../site-builder/store.service';
import {
  CATALOG_GENERATION_ATTEMPTS,
  CATALOG_GENERATION_COOLDOWN_SECONDS,
  CATALOG_GENERATION_TEMPERATURE,
} from './catalog.constants';
import { CategoryService } from './category.service';
import { ApplyCatalogDto } from './dto/apply-catalog.dto';
import { ApplyCatalogResultDto } from './dto/apply-catalog-result.dto';
import { GenerateCatalogDto } from './dto/generate-catalog.dto';
import { ProductAttributeService } from './product-attribute.service';
import {
  buildGenerateCatalogPrompt,
  buildGenerateCatalogSchema,
} from './prompts/generate-catalog.prompt';
import {
  CatalogProposal,
  isCatalogProposalEmpty,
  sanitizeGeneratedCatalog,
} from './utils/sanitize-catalog.util';

/** Marks the cooldown; the value is never read, only its TTL. */
const COOLDOWN_MARKER = '1';

/**
 * The AI catalog setup: one generation turns the questionnaire the owner
 * already answered into the store's categories and attributes.
 *
 * **Generating persists nothing.** The owner may already have a catalog,
 * `isVariantAxis` is immutable once products use it, and "AI revises on
 * request" means no attempt is authoritative — so the proposal comes back for
 * review and only `applyCatalog` writes.
 */
@Injectable()
export class CatalogAiService {
  private readonly logger = new Logger(CatalogAiService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly storeService: StoreService,
    private readonly siteBuilderService: SiteBuilderService,
    private readonly geminiService: GeminiService,
    private readonly redisService: RedisService,
    private readonly categoryService: CategoryService,
    private readonly productAttributeService: ProductAttributeService,
  ) {}

  /**
   * Proposes a whole catalog scaffold. Retries once when nothing survives
   * validation, because a single malformed response should cost a round trip
   * rather than the owner's click.
   */
  async generate(
    user: JwtPayload,
    dto: GenerateCatalogDto,
  ): Promise<CatalogProposal> {
    const store = await this.storeService.resolveCallerStore(user);
    await this.enforceCooldown(store.id);

    try {
      return await this.requestProposal(store, dto.instructions);
    } catch (err) {
      // The owner got nothing, so they should not have to wait to try again.
      await this.redisService.del(this.cooldownKey(store.id));
      throw err;
    }
  }

  /**
   * Writes what the owner kept, in **one transaction**: a bad attribute must
   * not leave half a catalog behind.
   *
   * Idempotent by name and slug — an entry the store already has is skipped,
   * not renamed, because a double-click is not a request for `abayas-2`.
   */
  async applyCatalog(
    user: JwtPayload,
    dto: ApplyCatalogDto,
  ): Promise<ApplyCatalogResultDto> {
    const store = await this.storeService.resolveCallerStore(user);

    return this.dataSource.transaction(async (manager) => {
      const categories = await this.categoryService.createBatch({
        manager,
        storeId: store.id,
        entries: dto.categories ?? [],
      });
      const attributes = await this.productAttributeService.createBatch({
        manager,
        storeId: store.id,
        entries: dto.attributes ?? [],
      });

      return ApplyCatalogResultDto.fromResults(categories, attributes);
    });
  }

  private async requestProposal(
    store: Store,
    instructions: string | undefined,
  ): Promise<CatalogProposal> {
    const prompt = buildGenerateCatalogPrompt({
      storeName: store.name,
      storeDescription: store.description,
      locale: store.locale,
      business: await this.siteBuilderService.describeBusinessForOwner(
        store.ownerId,
      ),
      instructions,
    });
    const schema = buildGenerateCatalogSchema();

    for (let attempt = 1; attempt <= CATALOG_GENERATION_ATTEMPTS; attempt++) {
      const raw = await this.geminiService.generateJson<unknown>({
        prompt,
        schema,
        temperature: CATALOG_GENERATION_TEMPERATURE,
      });

      const proposal = sanitizeGeneratedCatalog(raw);
      if (!isCatalogProposalEmpty(proposal)) {
        return proposal;
      }
      this.logger.warn(
        `Catalog generation ${attempt}/${CATALOG_GENERATION_ATTEMPTS} for store ${store.id} produced nothing usable`,
      );
    }

    throw new ServiceUnavailableException(AI_UNAVAILABLE_MESSAGE);
  }

  /**
   * Rejects a second generation inside the window, then opens a new one. Set
   * *before* the call, like the resend-OTP cooldown: this guards the Gemini
   * bill against an impatient owner, so it cannot wait for the answer.
   */
  private async enforceCooldown(storeId: string): Promise<void> {
    const key = this.cooldownKey(storeId);
    const remaining = await this.redisService.ttl(key);
    if (remaining > 0) {
      throw new HttpException(
        `A catalog was generated moments ago, please wait ${remaining} seconds before generating another`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.redisService.setex(
      key,
      CATALOG_GENERATION_COOLDOWN_SECONDS,
      COOLDOWN_MARKER,
    );
  }

  private cooldownKey(storeId: string): string {
    return `catalog-gen:${storeId}`;
  }
}
