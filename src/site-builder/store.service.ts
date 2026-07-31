import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, QueryFailedError, Repository } from 'typeorm';
import { EnvironmentVariables } from '../config/env.validation';
import { CloudinaryService } from '../storage/cloudinary.service';
import { UpdateHeroDto } from './dto/update-hero.dto';
import { StoreTheme } from './entities/store-theme.entity';
import { Store } from './entities/store.entity';
import { LogoSource } from './enums/logo-source.enum';
import { StoreStatus } from './enums/store-status.enum';
import {
  DEFAULT_HERO_CTA_LABEL,
  DEFAULT_LOCALE,
  HERO_SUBFOLDER,
  MAX_SLUG_SUGGESTIONS,
  RESERVED_SLUGS,
  SLUG_CANDIDATE_LIMIT,
  SLUG_PREFIX_MATCH_LENGTH,
  SLUG_SUGGESTION_SUFFIXES,
} from './site-builder.constants';
import {
  buildSlugVariants,
  isConfusableSlug,
} from './utils/slug-similarity.util';

const UNIQUE_VIOLATION = '23505';

/** Treats an empty edit as "clear this field" rather than "set it to blank". */
function toNullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface ConfirmDomainCommand {
  readonly ownerId: string;
  readonly name: string;
  readonly slug: string;
}

export interface StoreLogo {
  readonly url: string;
  readonly publicId: string;
  readonly source: LogoSource;
}

export interface StoreHeroCopy {
  readonly headline: string | null;
  readonly subtitle: string | null;
}

export interface PublishStoreCommand {
  readonly store: Store;
  readonly description: string | null;
  readonly logo: StoreLogo;
  readonly hero: StoreHeroCopy;
}

export interface UpdateHeroCommand {
  readonly ownerId: string;
  readonly hero: UpdateHeroDto;
  readonly image?: Buffer;
}

/** Owns the `Store` row: its identity, its slug, and how the public resolves it. */
@Injectable()
export class StoreService {
  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async findByOwnerId(ownerId: string): Promise<Store | null> {
    return this.storeRepository.findOne({ where: { ownerId } });
  }

  async getByOwnerId(ownerId: string): Promise<Store> {
    const store = await this.findByOwnerId(ownerId);
    if (!store) {
      throw new ConflictException('Confirm your domain before this step');
    }
    return store;
  }

  /**
   * Reserves `slug` for the owner — creating the store on the first call and
   * renaming it on later ones — and returns the confusable-slug advisory.
   */
  async confirmDomain({
    ownerId,
    name,
    slug,
  }: ConfirmDomainCommand): Promise<{ store: Store; hint: string | null }> {
    this.assertSlugIsAllowed(slug);

    const existing = await this.findByOwnerId(ownerId);
    await this.assertSlugIsAvailable(slug, existing?.id);
    const hint = await this.buildConfusableHint(slug, existing?.id);

    const store =
      existing ??
      this.storeRepository.create({
        ownerId,
        status: StoreStatus.Draft,
        locale: DEFAULT_LOCALE,
      });
    store.name = name;
    store.slug = slug;

    return { store: await this.saveUnique(store), hint };
  }

  /**
   * Copies the final branding onto the store and takes it live. The hero copy
   * only fills gaps — anything the owner already wrote in the dashboard survives
   * a re-publish.
   */
  async publish({
    store,
    description,
    logo,
    hero,
  }: PublishStoreCommand): Promise<Store> {
    store.description = description;
    store.logoUrl = logo.url;
    store.logoPublicId = logo.publicId;
    store.logoSource = logo.source;
    store.heroHeadline ??= hero.headline;
    store.heroSubtitle ??= hero.subtitle;
    store.heroCtaLabel ??= DEFAULT_HERO_CTA_LABEL;
    store.status = StoreStatus.Live;
    return this.storeRepository.save(store);
  }

  /** Dashboard edit of the landing page's hero block. */
  async updateHero({
    ownerId,
    hero,
    image,
  }: UpdateHeroCommand): Promise<Store> {
    const store = await this.getByOwnerId(ownerId);

    if (image) {
      const previousPublicId = store.heroImagePublicId;
      const uploaded = await this.cloudinaryService.uploadImage({
        buffer: image,
        subfolder: HERO_SUBFOLDER,
      });
      store.heroImageUrl = uploaded.url;
      store.heroImagePublicId = uploaded.publicId;
      if (previousPublicId) {
        await this.cloudinaryService.destroyImage(previousPublicId);
      }
    }

    this.applyHeroCopy(store, hero);
    return this.storeRepository.save(store);
  }

  /**
   * Resolves a published slug together with its selected theme. Draft stores are
   * reported as missing so an unpublished slug can never leak.
   */
  async resolvePublicStore(
    slug: string,
  ): Promise<{ store: Store; theme: StoreTheme | null }> {
    const store = await this.storeRepository
      .createQueryBuilder('store')
      .leftJoinAndSelect('store.themes', 'theme', 'theme.isSelected = true')
      .where('LOWER(store.slug) = :slug', { slug: slug.toLowerCase() })
      .andWhere('store.status = :status', { status: StoreStatus.Live })
      .getOne();

    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return { store, theme: store.themes[0] ?? null };
  }

  /**
   * Warns when an existing store has a name customers could confuse with this
   * slug. Advisory only — never blocks the owner.
   */
  async buildConfusableHint(
    slug: string,
    exceptStoreId?: string,
  ): Promise<string | null> {
    const conflict = await this.findConfusableSlug(slug, exceptStoreId);
    if (!conflict) {
      return null;
    }
    if (conflict === slug) {
      return `"${slug}" is already taken, so you will need a different domain.`;
    }
    return `"${conflict}" already exists on InventoAI. Your customers may confuse the two — a more distinct name is safer, but you can keep this one.`;
  }

  buildStoreUrl(slug: string): string {
    const baseUrl = this.configService
      .get('SITE_BASE_URL', { infer: true })
      .replace(/\/+$/, '');
    return `${baseUrl}/${slug}`;
  }

  /** An omitted field is left alone; an empty one is cleared. */
  private applyHeroCopy(store: Store, hero: UpdateHeroDto): void {
    if (hero.headline !== undefined) {
      store.heroHeadline = toNullableText(hero.headline);
    }
    if (hero.subtitle !== undefined) {
      store.heroSubtitle = toNullableText(hero.subtitle);
    }
    if (hero.ctaLabel !== undefined) {
      store.heroCtaLabel = toNullableText(hero.ctaLabel);
    }
    if (hero.ctaHref !== undefined) {
      store.heroCtaHref = toNullableText(hero.ctaHref);
    }
  }

  private assertSlugIsAllowed(slug: string): void {
    if (RESERVED_SLUGS.includes(slug)) {
      throw new BadRequestException(
        'This domain is reserved, please pick another',
      );
    }
  }

  private async assertSlugIsAvailable(
    slug: string,
    exceptStoreId?: string,
  ): Promise<void> {
    const owner = await this.storeRepository.findOne({
      where: { slug: ILike(slug) },
      select: { id: true },
    });
    if (owner && owner.id !== exceptStoreId) {
      throw new ConflictException({
        message: 'This domain is already taken',
        suggestions: await this.buildSuggestions(slug),
      });
    }
  }

  /** Same shape as the requested slug, with a suffix, and actually free. */
  private async buildSuggestions(slug: string): Promise<string[]> {
    const candidates = SLUG_SUGGESTION_SUFFIXES.map(
      (suffix) => `${slug}-${suffix}`,
    );
    const taken = await this.storeRepository.find({
      where: { slug: In(candidates) },
      select: { slug: true },
    });
    const takenSlugs = new Set(taken.map((store) => store.slug));
    return candidates
      .filter((candidate) => !takenSlugs.has(candidate))
      .slice(0, MAX_SLUG_SUGGESTIONS);
  }

  private async findConfusableSlug(
    slug: string,
    exceptStoreId?: string,
  ): Promise<string | null> {
    const prefix = slug.slice(0, SLUG_PREFIX_MATCH_LENGTH);
    const candidates = await this.storeRepository.find({
      where: [
        { slug: In(buildSlugVariants(slug)) },
        { slug: ILike(`${prefix}%`) },
      ],
      select: { id: true, slug: true },
      take: SLUG_CANDIDATE_LIMIT,
    });

    const conflict = candidates.find(
      (store) =>
        store.id !== exceptStoreId && isConfusableSlug(slug, store.slug),
    );
    return conflict?.slug ?? null;
  }

  /** Turns the unique-index race between two owners into the same 409. */
  private async saveUnique(store: Store): Promise<Store> {
    try {
      return await this.storeRepository.save(store);
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err.driverError as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException({
          message: 'This domain is already taken',
          suggestions: await this.buildSuggestions(store.slug),
        });
      }
      throw err;
    }
  }
}
