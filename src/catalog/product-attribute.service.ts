import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Like, QueryFailedError, Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ReorderDto } from '../common/dto/reorder.dto';
import { StoreService } from '../site-builder/store.service';
import {
  ATTRIBUTE_KEY_FALLBACK,
  ATTRIBUTE_KEY_MAX_LENGTH,
  ATTRIBUTE_VALUE_SLUG_MAX_LENGTH,
  MAX_ATTRIBUTES_PER_STORE,
  MAX_VALUES_PER_ATTRIBUTE,
  PRODUCT_DESCRIPTIVE_VALUES_TABLE,
  VARIANT_ATTRIBUTE_VALUES_TABLE,
} from './catalog.constants';
import { AttributeQueryDto } from './dto/attribute-query.dto';
import { CreateAttributeDto } from './dto/create-attribute.dto';
import { CreateAttributeValueDto } from './dto/create-attribute-value.dto';
import { UpdateAttributeDto } from './dto/update-attribute.dto';
import { UpdateAttributeValueDto } from './dto/update-attribute-value.dto';
import { Product } from './entities/product.entity';
import { ProductAttribute } from './entities/product-attribute.entity';
import { ProductAttributeValue } from './entities/product-attribute-value.entity';
import { AttributeDisplayStyle } from './enums/attribute-display-style.enum';
import { parseAttributeFilter } from './utils/attribute-filter.util';
import {
  CatalogBatchResult,
  CatalogEntryIdentity,
  planCatalogWrite,
} from './utils/plan-catalog-write.util';
import { ResolvedFacet } from './utils/product-predicates.util';
import { isReservedAttributeKey } from './utils/reserved-attribute-key.util';
import { slugifyToken } from './utils/slugify-token.util';
import { findSwatchPairingViolations } from './utils/swatch-pairing.util';
import { buildUniqueSlug } from './utils/unique-slug.util';

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof QueryFailedError &&
    (err.driverError as { code?: string }).code === UNIQUE_VIOLATION
  );
}

/** One proposed attribute, as the AI catalog setup hands it over. */
export interface AttributeDraft {
  readonly name: string;
  readonly key?: string;
  readonly isVariantAxis?: boolean;
  readonly isFilterable?: boolean;
  readonly showOnProductPage?: boolean;
  readonly displayStyle?: AttributeDisplayStyle;
  readonly values?: readonly CreateAttributeValueDto[];
}

export interface CreateAttributeBatchCommand {
  /** The transaction the whole apply shares. */
  readonly manager: EntityManager;
  readonly storeId: string;
  readonly entries: readonly AttributeDraft[];
}

/**
 * Owns `ProductAttribute` and its controlled value list — the rows that stand
 * in for the product columns a store builder cannot hardcode.
 *
 * Every method resolves the caller's store first and scopes its query by that
 * id, so an attribute of another store is invisible rather than forbidden.
 */
@Injectable()
export class ProductAttributeService {
  constructor(
    @InjectRepository(ProductAttribute)
    private readonly attributeRepository: Repository<ProductAttribute>,
    @InjectRepository(ProductAttributeValue)
    private readonly valueRepository: Repository<ProductAttributeValue>,
    private readonly storeService: StoreService,
  ) {}

  async create(
    user: JwtPayload,
    dto: CreateAttributeDto,
  ): Promise<ProductAttribute> {
    const store = await this.storeService.resolveCallerStore(user);
    await this.assertStoreHasRoom(store.id);

    const candidate = dto.key ?? this.deriveKey(dto.name);
    this.assertKeyAllowed(candidate);

    const displayStyle = dto.displayStyle ?? AttributeDisplayStyle.List;
    this.assertSwatchPairing(displayStyle, dto.values ?? []);

    const attribute = this.attributeRepository.create({
      storeId: store.id,
      name: dto.name.trim(),
      key: await this.buildKey(store.id, candidate),
      isVariantAxis: dto.isVariantAxis ?? false,
      isFilterable: dto.isFilterable ?? true,
      showOnProductPage: dto.showOnProductPage ?? true,
      displayStyle,
      position: await this.findNextPosition(store.id),
      values: this.buildValues(store.id, dto.values ?? []),
    });

    const saved = await this.saveUnique(attribute, candidate);
    return this.getScoped(store.id, saved.id);
  }

  /**
   * Creates a batch of attributes with their values inside a caller-supplied
   * transaction, used by the AI catalog setup.
   *
   * The store is **not** resolved here: the caller already did that, and the
   * batch has to share its transaction. Every rule the hand-driven create
   * enforces is enforced again — reserved keys, the swatch/hex pairing and the
   * per-store cap — because by now the proposal is untrusted client input like
   * any other, and a violation must roll the whole apply back.
   */
  async createBatch({
    manager,
    storeId,
    entries,
  }: CreateAttributeBatchCommand): Promise<CatalogBatchResult> {
    const repository = manager.getRepository(ProductAttribute);
    const existing = await repository.find({
      where: { storeId },
      select: { name: true, key: true },
    });

    entries.forEach((entry) => this.assertDraftIsValid(entry));

    const plan = planCatalogWrite({
      entries,
      existing: existing.map((attribute) => ({
        name: attribute.name,
        slug: attribute.key,
      })),
      identify: (entry) => this.identifyAttribute(entry),
    });
    if (plan.create.length === 0) {
      return { created: 0, skipped: [...plan.skipped] };
    }
    this.assertBatchFits(existing.length, plan.create.length);

    const nextPosition = await this.findNextPosition(storeId, manager);
    const attributes = plan.create.map(({ entry, slug }, index) =>
      repository.create({
        storeId,
        name: entry.name.trim(),
        key: slug,
        isVariantAxis: entry.isVariantAxis ?? false,
        isFilterable: entry.isFilterable ?? true,
        showOnProductPage: entry.showOnProductPage ?? true,
        displayStyle: entry.displayStyle ?? AttributeDisplayStyle.List,
        position: nextPosition + index,
        values: this.buildValues(storeId, entry.values ?? [], manager),
      }),
    );

    await repository.save(attributes);
    return { created: attributes.length, skipped: [...plan.skipped] };
  }

  /** Not paginated: a store has at most `MAX_ATTRIBUTES_PER_STORE` of them. */
  async list(
    user: JwtPayload,
    query: AttributeQueryDto,
  ): Promise<ProductAttribute[]> {
    const store = await this.storeService.resolveCallerStore(user);
    return this.listOrdered(store.id, query);
  }

  async getById(user: JwtPayload, id: string): Promise<ProductAttribute> {
    const store = await this.storeService.resolveCallerStore(user);
    return this.getScoped(store.id, id);
  }

  /**
   * `isVariantAxis` is not editable and the DTO does not carry it, so this only
   * ever touches presentation. Switching *to* `swatch` is rejected when a value
   * has no colour; switching *away* clears the colours instead of rejecting,
   * because the pair would otherwise deadlock — a `swatch` attribute cannot
   * drop a hex, and a non-`swatch` one cannot keep it.
   */
  async update(
    user: JwtPayload,
    id: string,
    dto: UpdateAttributeDto,
  ): Promise<ProductAttribute> {
    const store = await this.storeService.resolveCallerStore(user);
    const attribute = await this.getScoped(store.id, id);

    if (dto.name !== undefined) {
      attribute.name = dto.name.trim();
    }
    if (dto.isFilterable !== undefined) {
      attribute.isFilterable = dto.isFilterable;
    }
    if (dto.showOnProductPage !== undefined) {
      attribute.showOnProductPage = dto.showOnProductPage;
    }
    if (dto.displayStyle !== undefined) {
      await this.applyDisplayStyle(attribute, dto.displayStyle);
    }
    if (dto.key !== undefined && dto.key !== attribute.key) {
      this.assertKeyAllowed(dto.key);
      attribute.key = await this.buildKey(store.id, dto.key, attribute.id);
      await this.saveUnique(attribute, dto.key);
      return this.getScoped(store.id, attribute.id);
    }

    await this.attributeRepository.save(attribute);
    return this.getScoped(store.id, attribute.id);
  }

  /**
   * Soft delete, values included. An attribute still used by a live product is
   * a 409: deleting it would leave variants whose defining combination no
   * longer exists — a row that can be bought but not described.
   */
  async remove(user: JwtPayload, id: string): Promise<void> {
    const store = await this.storeService.resolveCallerStore(user);
    const attribute = await this.getScoped(store.id, id);

    const inUse = await this.countProductsUsingAttribute(attribute.id);
    if (inUse > 0) {
      throw new ConflictException(
        `${inUse} products still use this attribute. Turn off its filter instead, or remove it from those products first.`,
      );
    }

    await this.attributeRepository.manager.transaction(async (manager) => {
      await manager.softDelete(ProductAttributeValue, {
        attributeId: attribute.id,
      });
      await manager.softDelete(ProductAttribute, { id: attribute.id });
    });
  }

  async reorder(
    user: JwtPayload,
    dto: ReorderDto,
  ): Promise<ProductAttribute[]> {
    const store = await this.storeService.resolveCallerStore(user);
    await this.assertAttributesBelongToStore(
      store.id,
      dto.items.map((item) => item.id),
    );

    await this.attributeRepository.manager.transaction(async (manager) => {
      for (const item of dto.items) {
        await manager.update(
          ProductAttribute,
          { id: item.id, storeId: store.id },
          { position: item.position },
        );
      }
    });

    return this.listOrdered(store.id);
  }

  async addValue(
    user: JwtPayload,
    id: string,
    dto: CreateAttributeValueDto,
  ): Promise<ProductAttribute> {
    const store = await this.storeService.resolveCallerStore(user);
    const attribute = await this.getScoped(store.id, id);
    this.assertAttributeHasRoom(attribute);
    this.assertSwatchPairing(attribute.displayStyle, [dto]);

    const candidate = dto.slug ?? this.deriveValueSlug(dto.value);
    const value = this.valueRepository.create({
      attributeId: attribute.id,
      storeId: store.id,
      value: dto.value.trim(),
      slug: await this.buildValueSlug(attribute.id, candidate),
      swatchHex: dto.swatchHex ?? null,
      position: await this.findNextValuePosition(attribute.id),
    });

    await this.valueRepository.save(value);
    return this.getScoped(store.id, attribute.id);
  }

  async updateValue(
    user: JwtPayload,
    id: string,
    valueId: string,
    dto: UpdateAttributeValueDto,
  ): Promise<ProductAttribute> {
    const store = await this.storeService.resolveCallerStore(user);
    const attribute = await this.getScoped(store.id, id);
    const value = this.getValueOf(attribute, valueId);
    this.assertSwatchPairing(attribute.displayStyle, [
      {
        value: dto.value ?? value.value,
        swatchHex: dto.swatchHex ?? value.swatchHex,
      },
    ]);

    if (dto.value !== undefined) {
      value.value = dto.value.trim();
    }
    if (dto.swatchHex !== undefined) {
      value.swatchHex = dto.swatchHex;
    }
    if (dto.slug !== undefined && dto.slug !== value.slug) {
      value.slug = await this.buildValueSlug(attribute.id, dto.slug, value.id);
    }

    await this.valueRepository.save(value);
    return this.getScoped(store.id, attribute.id);
  }

  /** A value no product uses deletes freely; one in use is the same 409. */
  async removeValue(
    user: JwtPayload,
    id: string,
    valueId: string,
  ): Promise<ProductAttribute> {
    const store = await this.storeService.resolveCallerStore(user);
    const attribute = await this.getScoped(store.id, id);
    const value = this.getValueOf(attribute, valueId);

    const inUse = await this.countProductsUsingValue(value.id);
    if (inUse > 0) {
      throw new ConflictException(
        `${inUse} products still use this value. Remove it from those products first.`,
      );
    }

    await this.valueRepository.softRemove(value);
    return this.getScoped(store.id, attribute.id);
  }

  async reorderValues(
    user: JwtPayload,
    id: string,
    dto: ReorderDto,
  ): Promise<ProductAttribute> {
    const store = await this.storeService.resolveCallerStore(user);
    const attribute = await this.getScoped(store.id, id);
    this.assertValuesBelongToAttribute(
      attribute,
      dto.items.map((item) => item.id),
    );

    await this.valueRepository.manager.transaction(async (manager) => {
      for (const item of dto.items) {
        await manager.update(
          ProductAttributeValue,
          { id: item.id, attributeId: attribute.id },
          { position: item.position },
        );
      }
    });

    return this.getScoped(store.id, attribute.id);
  }

  /**
   * The caller's own values, keyed by id and carrying their parent attribute.
   *
   * The products branch resolves ids through this rather than through a repo of
   * its own, so "does this value belong to my store?" is asked in exactly one
   * place. An id that is unknown or foreign is simply absent from the map — the
   * caller decides what that means, because the message differs between a
   * product-level value and a variant's.
   */
  async loadValuesByIds(
    storeId: string,
    ids: readonly string[],
  ): Promise<Map<string, ProductAttributeValue>> {
    if (ids.length === 0) {
      return new Map();
    }

    const values = await this.valueRepository.find({
      where: { storeId, id: In([...new Set(ids)]) },
      relations: { attribute: true },
    });
    return new Map(values.map((value) => [value.id, value]));
  }

  /** The attributes the storefront sidebar may offer, values in owner order. */
  async listFilterable(storeId: string): Promise<ProductAttribute[]> {
    return this.listOrdered(storeId, { isFilterable: true });
  }

  /**
   * Resolves `?attributes=size:xl,l;color:red` against the store's own rows.
   *
   * **An unknown key or value is ignored, not rejected.** A 400 would be better
   * for debugging, but these URLs get bookmarked and shared, and an owner
   * deleting a value would turn every shared link into an error page. Narrowing
   * silently to the filters that still exist is what a storefront needs.
   */
  async resolveFacets(
    storeId: string,
    raw: string | undefined,
  ): Promise<ResolvedFacet[]> {
    const requested = parseAttributeFilter(raw);
    if (requested.size === 0) {
      return [];
    }

    const attributes = await this.attributeRepository.find({
      where: { storeId, key: In([...requested.keys()]), isFilterable: true },
      relations: { values: true },
    });

    return attributes
      .map((attribute) => ({
        key: attribute.key,
        isVariantAxis: attribute.isVariantAxis,
        valueIds: attribute.values
          .filter((value) =>
            (requested.get(attribute.key) ?? []).includes(value.slug),
          )
          .map((value) => value.id),
      }))
      .filter((facet) => facet.valueIds.length > 0);
  }

  private async listOrdered(
    storeId: string,
    filters: AttributeQueryDto = {},
  ): Promise<ProductAttribute[]> {
    return this.attributeRepository.find({
      where: {
        storeId,
        ...(filters.isVariantAxis !== undefined && {
          isVariantAxis: filters.isVariantAxis,
        }),
        ...(filters.isFilterable !== undefined && {
          isFilterable: filters.isFilterable,
        }),
      },
      relations: { values: true },
      order: {
        position: 'ASC',
        createdAt: 'ASC',
        values: { position: 'ASC', createdAt: 'ASC' },
      },
    });
  }

  /** An attribute of another store must look missing, never forbidden. */
  private async getScoped(
    storeId: string,
    id: string,
  ): Promise<ProductAttribute> {
    const attribute = await this.attributeRepository.findOne({
      where: { id, storeId },
      relations: { values: true },
      order: { values: { position: 'ASC', createdAt: 'ASC' } },
    });
    if (!attribute) {
      throw new NotFoundException('Attribute not found');
    }
    return attribute;
  }

  private getValueOf(
    attribute: ProductAttribute,
    valueId: string,
  ): ProductAttributeValue {
    const value = attribute.values.find(
      (candidate) => candidate.id === valueId,
    );
    if (!value) {
      throw new NotFoundException('Attribute value not found');
    }
    return value;
  }

  /**
   * Applies a style change together with the colours it implies, so the pair
   * the rendering contract promises can never be half-written.
   */
  private async applyDisplayStyle(
    attribute: ProductAttribute,
    displayStyle: AttributeDisplayStyle,
  ): Promise<void> {
    this.assertSwatchPairing(
      displayStyle,
      displayStyle === AttributeDisplayStyle.Swatch ? attribute.values : [],
    );
    attribute.displayStyle = displayStyle;

    if (displayStyle !== AttributeDisplayStyle.Swatch) {
      await this.valueRepository.update(
        { attributeId: attribute.id },
        { swatchHex: null },
      );
      attribute.values.forEach((value) => {
        value.swatchHex = null;
      });
    }
  }

  private assertSwatchPairing(
    displayStyle: AttributeDisplayStyle,
    values: readonly { value: string; swatchHex?: string | null }[],
  ): void {
    const violations = findSwatchPairingViolations({ displayStyle, values });
    if (violations.length === 0) {
      return;
    }

    const detail = violations.join(', ');
    throw new BadRequestException(
      displayStyle === AttributeDisplayStyle.Swatch
        ? `A swatch attribute needs a #RRGGBB colour on every value. Missing: ${detail}`
        : `swatchHex is only allowed on a swatch attribute. Remove it from: ${detail}`,
    );
  }

  /**
   * The batch's identity: the name the skip rule matches on, and the key it
   * asks for. `isFallbackCandidate` marks a name with no Latin characters —
   * every Arabic name slugifies to the same token, so the planner must not read
   * that collision as "already applied".
   */
  private identifyAttribute(entry: AttributeDraft): CatalogEntryIdentity {
    if (entry.key) {
      return {
        name: entry.name,
        candidate: entry.key,
        isFallbackCandidate: false,
      };
    }

    const candidate = this.deriveKey(entry.name);
    return {
      name: entry.name,
      candidate,
      isFallbackCandidate: candidate === ATTRIBUTE_KEY_FALLBACK,
    };
  }

  /** The create-time rules, re-run on a batch before any of it is written. */
  private assertDraftIsValid(entry: AttributeDraft): void {
    this.assertKeyAllowed(this.identifyAttribute(entry).candidate);
    this.assertSwatchPairing(
      entry.displayStyle ?? AttributeDisplayStyle.List,
      entry.values ?? [],
    );
  }

  private assertBatchFits(existing: number, incoming: number): void {
    if (existing + incoming > MAX_ATTRIBUTES_PER_STORE) {
      throw new BadRequestException(
        `A store may define at most ${MAX_ATTRIBUTES_PER_STORE} attributes`,
      );
    }
  }

  private assertKeyAllowed(key: string): void {
    if (isReservedAttributeKey(key)) {
      throw new BadRequestException(
        `"${key}" is reserved by the storefront's built-in filters. Pick another key.`,
      );
    }
  }

  private async assertStoreHasRoom(storeId: string): Promise<void> {
    const total = await this.attributeRepository.count({ where: { storeId } });
    if (total >= MAX_ATTRIBUTES_PER_STORE) {
      throw new BadRequestException(
        `A store may define at most ${MAX_ATTRIBUTES_PER_STORE} attributes`,
      );
    }
  }

  private assertAttributeHasRoom(attribute: ProductAttribute): void {
    if (attribute.values.length >= MAX_VALUES_PER_ATTRIBUTE) {
      throw new BadRequestException(
        `An attribute may have at most ${MAX_VALUES_PER_ATTRIBUTE} values`,
      );
    }
  }

  private async assertAttributesBelongToStore(
    storeId: string,
    ids: string[],
  ): Promise<void> {
    const found = await this.attributeRepository.find({
      where: { storeId, id: In(ids) },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException(
        'Every attribute must belong to your store and appear once',
      );
    }
  }

  private assertValuesBelongToAttribute(
    attribute: ProductAttribute,
    ids: string[],
  ): void {
    const owned = new Set(attribute.values.map((value) => value.id));
    const isComplete =
      new Set(ids).size === ids.length && ids.every((id) => owned.has(id));
    if (!isComplete) {
      throw new BadRequestException(
        'Every value must belong to this attribute and appear once',
      );
    }
  }

  /**
   * Values created alongside their attribute: slugs de-duplicated within the
   * batch, positions in the order the owner listed them — S, M, L, not the
   * alphabetical order no size sorts by.
   */
  private buildValues(
    storeId: string,
    values: readonly CreateAttributeValueDto[],
    manager?: EntityManager,
  ): ProductAttributeValue[] {
    const repository = manager
      ? manager.getRepository(ProductAttributeValue)
      : this.valueRepository;
    const taken = new Set<string>();

    return values.map((dto, index) => {
      const slug = buildUniqueSlug({
        candidate: dto.slug ?? this.deriveValueSlug(dto.value),
        taken,
      });
      taken.add(slug);

      return repository.create({
        storeId,
        value: dto.value.trim(),
        slug,
        swatchHex: dto.swatchHex ?? null,
        position: index,
      });
    });
  }

  private deriveKey(name: string): string {
    return slugifyToken({
      text: name,
      fallback: ATTRIBUTE_KEY_FALLBACK,
      maxLength: ATTRIBUTE_KEY_MAX_LENGTH,
    });
  }

  private deriveValueSlug(value: string): string {
    return slugifyToken({
      text: value,
      fallback: 'value',
      maxLength: ATTRIBUTE_VALUE_SLUG_MAX_LENGTH,
    });
  }

  /** Resolves the candidate against the keys this store already uses. */
  private async buildKey(
    storeId: string,
    candidate: string,
    exceptAttributeId?: string,
  ): Promise<string> {
    const rows = await this.attributeRepository.find({
      where: [
        { storeId, key: candidate },
        { storeId, key: Like(`${candidate}-%`) },
      ],
      select: { id: true, key: true },
    });

    const taken = new Set(
      rows.filter((row) => row.id !== exceptAttributeId).map((row) => row.key),
    );
    return buildUniqueSlug({ candidate, taken });
  }

  private async buildValueSlug(
    attributeId: string,
    candidate: string,
    exceptValueId?: string,
  ): Promise<string> {
    const rows = await this.valueRepository.find({
      where: [
        { attributeId, slug: candidate },
        { attributeId, slug: Like(`${candidate}-%`) },
      ],
      select: { id: true, slug: true },
    });

    const taken = new Set(
      rows.filter((row) => row.id !== exceptValueId).map((row) => row.slug),
    );
    return buildUniqueSlug({ candidate, taken });
  }

  private async findNextPosition(
    storeId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const repository = manager
      ? manager.getRepository(ProductAttribute)
      : this.attributeRepository;
    const row = await repository
      .createQueryBuilder('attribute')
      .select('MAX(attribute.position)', 'max')
      .where('attribute.storeId = :storeId', { storeId })
      .getRawOne<{ max: number | null }>();
    return Number(row?.max ?? -1) + 1;
  }

  private async findNextValuePosition(attributeId: string): Promise<number> {
    const row = await this.valueRepository
      .createQueryBuilder('value')
      .select('MAX(value.position)', 'max')
      .where('value.attributeId = :attributeId', { attributeId })
      .getRawOne<{ max: number | null }>();
    return Number(row?.max ?? -1) + 1;
  }

  /** Products referencing any value of this attribute, from either direction. */
  private async countProductsUsingAttribute(
    attributeId: string,
  ): Promise<number> {
    const values = await this.valueRepository.find({
      where: { attributeId },
      select: { id: true },
    });
    return this.countProductsUsingValues(values.map((value) => value.id));
  }

  private async countProductsUsingValue(valueId: string): Promise<number> {
    return this.countProductsUsingValues([valueId]);
  }

  /**
   * A value is "in use" whether it describes a product or defines one of its
   * variants, so both join tables are checked. Soft-deleted products do not
   * count — the owner already removed them.
   */
  private async countProductsUsingValues(
    valueIds: readonly string[],
  ): Promise<number> {
    if (valueIds.length === 0) {
      return 0;
    }

    return this.attributeRepository.manager
      .createQueryBuilder(Product, 'product')
      .where(
        `EXISTS (
          SELECT 1 FROM ${PRODUCT_DESCRIPTIVE_VALUES_TABLE} link
          WHERE link."productId" = product.id
            AND link."attributeValueId" IN (:...valueIds)
        ) OR EXISTS (
          SELECT 1 FROM product_variants variant
          JOIN ${VARIANT_ATTRIBUTE_VALUES_TABLE} link ON link."variantId" = variant.id
          WHERE variant."productId" = product.id
            AND variant."deletedAt" IS NULL
            AND link."attributeValueId" IN (:...valueIds)
        )`,
        { valueIds: [...valueIds] },
      )
      .getCount();
  }

  /**
   * Turns the unique-index race between two concurrent creates into one retry
   * on a freshly resolved key — the same defensive shape as
   * `CategoryService.saveUnique`.
   */
  private async saveUnique(
    attribute: ProductAttribute,
    candidate: string,
  ): Promise<ProductAttribute> {
    try {
      return await this.attributeRepository.save(attribute);
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }
      attribute.key = await this.buildKey(
        attribute.storeId,
        candidate,
        attribute.id,
      );
      return this.attributeRepository.save(attribute);
    }
  }
}
