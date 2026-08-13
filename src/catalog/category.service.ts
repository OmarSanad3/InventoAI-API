import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, QueryFailedError, Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { StoreService } from '../site-builder/store.service';
import { slugify } from '../site-builder/utils/slugify.util';
import { CloudinaryService } from '../storage/cloudinary.service';
import {
  CATEGORY_SUBFOLDER,
  MAX_FEATURED_CATEGORIES,
  PRODUCT_CATEGORIES_TABLE,
} from './catalog.constants';
import { CategoryQueryDto } from './dto/category-query.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ReorderCategoriesDto } from './dto/reorder-categories.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from './entities/category.entity';
import { Product } from './entities/product.entity';
import { ProductStatus } from './enums/product-status.enum';
import { buildUniqueSlug } from './utils/unique-slug.util';

const UNIQUE_VIOLATION = '23505';

/** Treats an empty edit as "clear this field" rather than "set it to blank". */
function toNullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string }).code === UNIQUE_VIOLATION
  );
}

/**
 * Owns the `Category` row. Every method resolves the caller's store first and
 * scopes its query by that id, so a category of another store is invisible
 * rather than forbidden.
 */
@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    private readonly storeService: StoreService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async create(user: JwtPayload, dto: CreateCategoryDto): Promise<Category> {
    const store = await this.storeService.resolveCallerStore(user);
    const candidate = dto.slug ?? slugify(dto.name);

    const category = this.categoryRepository.create({
      storeId: store.id,
      name: dto.name.trim(),
      slug: await this.buildSlug(store.id, candidate),
      description: dto.description ? toNullableText(dto.description) : null,
      position: await this.findNextPosition(store.id),
      isPublished: dto.isPublished ?? true,
      isFeatured: dto.isFeatured ?? false,
    });

    return this.saveUnique(category, candidate);
  }

  /** The dashboard list — unpublished categories included, that is the point. */
  async list(
    user: JwtPayload,
    query: CategoryQueryDto,
  ): Promise<[Category[], number]> {
    const store = await this.storeService.resolveCallerStore(user);

    const builder = this.categoryRepository
      .createQueryBuilder('category')
      .where('category.storeId = :storeId', { storeId: store.id });

    if (query.search) {
      builder.andWhere('category.name ILIKE :search', {
        search: `%${query.search}%`,
      });
    }
    if (query.isPublished !== undefined) {
      builder.andWhere('category.isPublished = :isPublished', {
        isPublished: query.isPublished,
      });
    }
    if (query.isFeatured !== undefined) {
      builder.andWhere('category.isFeatured = :isFeatured', {
        isFeatured: query.isFeatured,
      });
    }

    const [categories, total] = await builder
      .orderBy('category.position', 'ASC')
      .addOrderBy('category.createdAt', 'ASC')
      .skip(query.offset)
      .take(query.limit)
      .getManyAndCount();

    return [await this.attachProductCounts(categories), total];
  }

  async getById(user: JwtPayload, id: string): Promise<Category> {
    const store = await this.storeService.resolveCallerStore(user);
    const category = await this.getScoped(store.id, id);
    const [withCount] = await this.attachProductCounts([category]);
    return withCount;
  }

  async update(
    user: JwtPayload,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<Category> {
    const store = await this.storeService.resolveCallerStore(user);
    const category = await this.getScoped(store.id, id);

    if (dto.name !== undefined) {
      category.name = dto.name.trim();
    }
    if (dto.description !== undefined) {
      category.description = toNullableText(dto.description);
    }
    if (dto.isPublished !== undefined) {
      category.isPublished = dto.isPublished;
    }
    if (dto.isFeatured !== undefined) {
      category.isFeatured = dto.isFeatured;
    }
    if (dto.slug !== undefined && dto.slug !== category.slug) {
      category.slug = await this.buildSlug(store.id, dto.slug, category.id);
      const renamed = await this.saveUnique(category, dto.slug);
      const [withCount] = await this.attachProductCounts([renamed]);
      return withCount;
    }

    return this.saveWithCount(category);
  }

  /**
   * Soft delete. The image is left on Cloudinary on purpose — a category
   * deleted by accident and later restored would otherwise come back blank.
   */
  async remove(user: JwtPayload, id: string): Promise<void> {
    const store = await this.storeService.resolveCallerStore(user);
    const category = await this.getScoped(store.id, id);
    await this.categoryRepository.softRemove(category);
  }

  /**
   * Applies the whole re-ordered list in one transaction. Every id is checked
   * against the store first: a partial reorder is worse than a rejected one.
   */
  async reorder(
    user: JwtPayload,
    dto: ReorderCategoriesDto,
  ): Promise<Category[]> {
    const store = await this.storeService.resolveCallerStore(user);
    const ids = dto.items.map((item) => item.id);
    await this.assertIdsBelongToStore(store.id, ids);

    await this.categoryRepository.manager.transaction(async (manager) => {
      for (const item of dto.items) {
        await manager.update(
          Category,
          { id: item.id, storeId: store.id },
          { position: item.position },
        );
      }
    });

    return this.listOrdered(store.id);
  }

  async replaceImage(
    user: JwtPayload,
    id: string,
    image: Buffer,
  ): Promise<Category> {
    const store = await this.storeService.resolveCallerStore(user);
    const category = await this.getScoped(store.id, id);
    const previousPublicId = category.imagePublicId;

    const uploaded = await this.cloudinaryService.uploadImage({
      buffer: image,
      subfolder: CATEGORY_SUBFOLDER,
    });
    category.imageUrl = uploaded.url;
    category.imagePublicId = uploaded.publicId;

    const saved = await this.saveWithCount(category);
    if (previousPublicId) {
      await this.cloudinaryService.destroyImage(previousPublicId);
    }
    return saved;
  }

  async removeImage(user: JwtPayload, id: string): Promise<Category> {
    const store = await this.storeService.resolveCallerStore(user);
    const category = await this.getScoped(store.id, id);
    const previousPublicId = category.imagePublicId;

    category.imageUrl = null;
    category.imagePublicId = null;

    const saved = await this.saveWithCount(category);
    if (previousPublicId) {
      await this.cloudinaryService.destroyImage(previousPublicId);
    }
    return saved;
  }

  /**
   * The storefront navigation: published categories of a live store, in the
   * order the owner arranged them. Not paginated — a store has tens of
   * categories and the navigation renders all of them at once.
   */
  async listPublished(slug: string): Promise<Category[]> {
    const { store } = await this.storeService.resolvePublicStore(slug);
    return this.listOrdered(store.id, { publishedOnly: true });
  }

  /** The landing page's featured strip, capped so it cannot grow unbounded. */
  async listFeatured(storeId: string): Promise<Category[]> {
    const categories = await this.categoryRepository.find({
      where: { storeId, isPublished: true, isFeatured: true },
      order: { position: 'ASC', createdAt: 'ASC' },
      take: MAX_FEATURED_CATEGORIES,
    });
    return this.attachProductCounts(categories, { activeOnly: true });
  }

  private async listOrdered(
    storeId: string,
    { publishedOnly = false }: { publishedOnly?: boolean } = {},
  ): Promise<Category[]> {
    const categories = await this.categoryRepository.find({
      where: publishedOnly ? { storeId, isPublished: true } : { storeId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    return this.attachProductCounts(categories, { activeOnly: publishedOnly });
  }

  private async saveWithCount(category: Category): Promise<Category> {
    const saved = await this.categoryRepository.save(category);
    const [withCount] = await this.attachProductCounts([saved]);
    return withCount;
  }

  /**
   * Fills the transient `Category.productCount` from one grouped query rather
   * than a count per row. The storefront counts only what a shopper can buy;
   * the dashboard counts drafts too, because the owner is looking for their own
   * work in progress.
   */
  private async attachProductCounts(
    categories: Category[],
    { activeOnly = false }: { activeOnly?: boolean } = {},
  ): Promise<Category[]> {
    if (categories.length === 0) {
      return categories;
    }

    const builder = this.categoryRepository.manager
      .createQueryBuilder(Product, 'product')
      .innerJoin(
        PRODUCT_CATEGORIES_TABLE,
        'link',
        'link."productId" = product.id',
      )
      .where('link."categoryId" IN (:...categoryIds)', {
        categoryIds: categories.map((category) => category.id),
      })
      .select('link."categoryId"', 'categoryId')
      .addSelect('COUNT(product.id)', 'count')
      .groupBy('link."categoryId"');

    if (activeOnly) {
      builder.andWhere('product.status = :status', {
        status: ProductStatus.Active,
      });
    }

    const rows = await builder.getRawMany<{
      categoryId: string;
      count: string;
    }>();
    const counts = new Map(rows.map((row) => [row.categoryId, +row.count]));

    categories.forEach((category) => {
      category.productCount = counts.get(category.id) ?? 0;
    });
    return categories;
  }

  /** A category of another store must look missing, never forbidden. */
  private async getScoped(storeId: string, id: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { id, storeId },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
  }

  private async assertIdsBelongToStore(
    storeId: string,
    ids: string[],
  ): Promise<void> {
    const found = await this.categoryRepository.find({
      where: { storeId, id: In(ids) },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException(
        'Every category must belong to your store and appear once',
      );
    }
  }

  /** Resolves the candidate against the slugs this store already uses. */
  private async buildSlug(
    storeId: string,
    candidate: string,
    exceptCategoryId?: string,
  ): Promise<string> {
    const rows = await this.categoryRepository.find({
      where: [
        { storeId, slug: candidate },
        { storeId, slug: Like(`${candidate}-%`) },
      ],
      select: { id: true, slug: true },
    });

    const taken = new Set(
      rows.filter((row) => row.id !== exceptCategoryId).map((row) => row.slug),
    );
    return buildUniqueSlug({ candidate, taken });
  }

  private async findNextPosition(storeId: string): Promise<number> {
    const row = await this.categoryRepository
      .createQueryBuilder('category')
      .select('MAX(category.position)', 'max')
      .where('category.storeId = :storeId', { storeId })
      .getRawOne<{ max: number | null }>();
    return Number(row?.max ?? -1) + 1;
  }

  /**
   * Turns the unique-index race between two concurrent creates into one retry
   * on a freshly resolved slug — the same defensive shape as
   * `StoreService.saveUnique`.
   */
  private async saveUnique(
    category: Category,
    candidate: string,
  ): Promise<Category> {
    try {
      return await this.categoryRepository.save(category);
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }
      category.slug = await this.buildSlug(
        category.storeId,
        candidate,
        category.id,
      );
      return this.categoryRepository.save(category);
    }
  }
}
