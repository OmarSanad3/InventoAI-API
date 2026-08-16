import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../catalog/entities/category.entity';
import { Product } from '../catalog/entities/product.entity';
import { ProductStatus } from '../catalog/enums/product-status.enum';
import { Faq } from '../faq/entities/faq.entity';
import { Store } from '../site-builder/entities/store.entity';
import { SiteBuilderService } from '../site-builder/site-builder.service';
import { KnowledgeSourceType } from './enums/knowledge-source-type.enum';
import {
  buildCategoryDocument,
  buildFaqDocument,
  buildProductDocument,
  buildStoreProfileDocument,
} from './utils/build-document.util';

/**
 * Postgres returns a many-to-many in whatever order it likes, and the composed
 * document is hashed — so an unsorted relation makes the hash flip between two
 * values and every reconcile re-embeds the whole catalogue for nothing. `id` is
 * the tie-break, because `position` is not unique.
 */
function sortByPosition<T extends { position: number; id: string }>(
  rows: readonly T[] | undefined,
): T[] {
  return [...(rows ?? [])].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  );
}

export interface DocumentKey {
  readonly storeId: string;
  readonly sourceType: KnowledgeSourceType;
  readonly sourceId: string;
}

/**
 * Turns a source row into the text that gets embedded — and, just as
 * importantly, decides that a row no longer belongs in the index at all.
 *
 * **`null` means "delete this document".** Every load applies the same
 * predicates the storefront applies, so an archived product, an unpublished FAQ
 * or a soft-deleted category composes to nothing and its document is removed.
 * That makes this the authority on membership, which is why the subscriber that
 * marks documents stale does not have to re-implement the rules.
 */
@Injectable()
export class KnowledgeComposer {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Faq)
    private readonly faqRepository: Repository<Faq>,
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    private readonly siteBuilderService: SiteBuilderService,
  ) {}

  async compose(key: DocumentKey): Promise<string | null> {
    switch (key.sourceType) {
      case KnowledgeSourceType.Product:
        return this.composeProduct(key);
      case KnowledgeSourceType.Category:
        return this.composeCategory(key);
      case KnowledgeSourceType.Faq:
        return this.composeFaq(key);
      case KnowledgeSourceType.StoreProfile:
        return this.composeStoreProfile(key);
      default:
        return null;
    }
  }

  /**
   * Every store, from the source table rather than from the documents — a store
   * whose index was never built has nothing to list itself by, and it is exactly
   * the one a reconcile has to reach.
   */
  async listStoreIds(): Promise<string[]> {
    const stores = await this.storeRepository.find({ select: { id: true } });
    return stores.map((store) => store.id);
  }

  /** Every source id a store's index should currently hold, by type. */
  async listSourceIds(
    storeId: string,
  ): Promise<Map<KnowledgeSourceType, string[]>> {
    const [products, categories, faqs] = await Promise.all([
      this.productRepository.find({
        where: { storeId, status: ProductStatus.Active },
        select: { id: true },
      }),
      this.categoryRepository.find({
        where: { storeId, isPublished: true },
        select: { id: true },
      }),
      this.faqRepository.find({
        where: { storeId, isPublished: true },
        select: { id: true },
      }),
    ]);

    return new Map([
      [KnowledgeSourceType.Product, products.map((row) => row.id)],
      [KnowledgeSourceType.Category, categories.map((row) => row.id)],
      [KnowledgeSourceType.Faq, faqs.map((row) => row.id)],
      [KnowledgeSourceType.StoreProfile, [storeId]],
    ]);
  }

  private async composeProduct(key: DocumentKey): Promise<string | null> {
    const product = await this.productRepository.findOne({
      where: {
        id: key.sourceId,
        storeId: key.storeId,
        status: ProductStatus.Active,
      },
      relations: { categories: true, attributeValues: { attribute: true } },
    });
    if (!product) {
      return null;
    }

    return buildProductDocument({
      title: product.title,
      shortDescription: product.shortDescription,
      description: product.description,
      searchKeywords: product.searchKeywords,
      categoryNames: sortByPosition(product.categories).map(
        (category) => category.name,
      ),
      // `Product.attributeValues` is descriptive-only by construction — a value
      // of an attribute flagged `isVariantAxis` is a 400 on the way in — so
      // there is nothing to filter here. Size and Colour live on the variant.
      descriptiveValues: sortByPosition(product.attributeValues).map(
        (value) => ({
          attribute: value.attribute?.name ?? '',
          value: value.value,
        }),
      ),
    });
  }

  private async composeCategory(key: DocumentKey): Promise<string | null> {
    const category = await this.categoryRepository.findOne({
      where: { id: key.sourceId, storeId: key.storeId, isPublished: true },
    });
    return category ? buildCategoryDocument(category) : null;
  }

  private async composeFaq(key: DocumentKey): Promise<string | null> {
    const faq = await this.faqRepository.findOne({
      where: { id: key.sourceId, storeId: key.storeId, isPublished: true },
    });
    return faq ? buildFaqDocument(faq) : null;
  }

  private async composeStoreProfile(key: DocumentKey): Promise<string | null> {
    const store = await this.storeRepository.findOne({
      where: { id: key.storeId },
    });
    if (!store) {
      return null;
    }

    // The questionnaire the owner already answered, rendered by the site
    // builder's own helper rather than re-read out of its jsonb here.
    const businessSummary = await this.siteBuilderService
      .describeBusinessForOwner(store.ownerId)
      .catch(() => '');

    return buildStoreProfileDocument({
      name: store.name,
      description: store.description,
      businessSummary,
    });
  }
}
