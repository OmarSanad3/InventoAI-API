import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  EntitySubscriberInterface,
  InsertEvent,
  RemoveEvent,
  SoftRemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { Category } from '../catalog/entities/category.entity';
import { Product } from '../catalog/entities/product.entity';
import { ProductStatus } from '../catalog/enums/product-status.enum';
import { Faq } from '../faq/entities/faq.entity';
import { Store } from '../site-builder/entities/store.entity';
import { KnowledgeSourceType } from './enums/knowledge-source-type.enum';
import { DocumentKey } from './knowledge-composer.service';
import { KnowledgeIndexer } from './knowledge-indexer.service';

type IndexedEntity = Product | Category | Faq | Store;

/** Keyed by the entity class TypeORM reports as the event's target. */
const SOURCE_TYPES = new Map<unknown, KnowledgeSourceType>([
  [Product, KnowledgeSourceType.Product],
  [Category, KnowledgeSourceType.Category],
  [Faq, KnowledgeSourceType.Faq],
  [Store, KnowledgeSourceType.StoreProfile],
]);

/**
 * Marks a knowledge document stale whenever a row it was composed from is
 * written.
 *
 * A subscriber rather than a call in each service: there are a dozen writers
 * between the catalog, the FAQ and the site builder, and the one that forgets to
 * mark is the one that silently rots the index. This cannot be forgotten,
 * because it is the ORM that remembers.
 *
 * It only ever **marks** — composing needs relations loaded, and doing that
 * inside someone else's transaction is how a product save becomes slow. The
 * exception is a row that has clearly left the storefront, which is deleted from
 * the index at once rather than retrieving for another minute.
 *
 * **Known gap:** TypeORM subscribers do not fire for query-builder bulk writes
 * (`.update()…execute()`), and this codebase uses those — the conditional stock
 * decrement, the reorder transactions. None of them touch text that is in a
 * document, so nothing is lost today; the nightly reconcile is the net under it
 * either way.
 */
@Injectable()
export class KnowledgeSubscriber implements EntitySubscriberInterface<IndexedEntity> {
  private readonly logger = new Logger(KnowledgeSubscriber.name);

  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly indexer: KnowledgeIndexer,
  ) {
    dataSource.subscribers.push(this);
  }

  async afterInsert(event: InsertEvent<IndexedEntity>): Promise<void> {
    await this.apply(event.manager, event.metadata.target, event.entity);
  }

  async afterUpdate(event: UpdateEvent<IndexedEntity>): Promise<void> {
    const entity = (event.entity ?? event.databaseEntity) as
      IndexedEntity | undefined;
    await this.apply(event.manager, event.metadata.target, entity);
  }

  async afterRemove(event: RemoveEvent<IndexedEntity>): Promise<void> {
    await this.forget(
      event.manager,
      event.metadata.target,
      event.databaseEntity ?? event.entity,
    );
  }

  async afterSoftRemove(event: SoftRemoveEvent<IndexedEntity>): Promise<void> {
    await this.forget(
      event.manager,
      event.metadata.target,
      event.databaseEntity ?? event.entity,
    );
  }

  private async apply(
    manager: EntityManager,
    target: unknown,
    entity: IndexedEntity | undefined,
  ): Promise<void> {
    const key = this.resolveKey(target, entity);
    if (!key || !entity) {
      return;
    }

    try {
      // A row whose visibility flag is present and false leaves the index now.
      // Anything else is marked stale, and the composer decides membership when
      // the sweep reaches it — it is the one place the storefront predicates
      // live, so this does not re-implement them.
      if (isDefinitelyHidden(entity)) {
        await this.indexer.removeDocument(manager, key);
        return;
      }
      await this.indexer.markStale(manager, key);
    } catch (err) {
      // Never let indexing break the write that triggered it.
      this.logger.warn(
        `Could not mark ${key.sourceType} stale: ${String(err)}`,
      );
    }
  }

  private async forget(
    manager: EntityManager,
    target: unknown,
    entity: IndexedEntity | undefined,
  ): Promise<void> {
    const key = this.resolveKey(target, entity);
    if (!key) {
      return;
    }

    try {
      await this.indexer.removeDocument(manager, key);
    } catch (err) {
      this.logger.warn(
        `Could not remove a ${key.sourceType} document: ${String(err)}`,
      );
    }
  }

  private resolveKey(
    target: unknown,
    entity: IndexedEntity | undefined,
  ): DocumentKey | null {
    if (typeof target === 'string' || !entity) {
      return null;
    }

    const sourceType = SOURCE_TYPES.get(target);
    if (!sourceType) {
      return null;
    }

    // A store profile is keyed by the store itself; everything else by its own
    // id inside its store.
    if (sourceType === KnowledgeSourceType.StoreProfile) {
      const store = entity as Store;
      return store.id
        ? { storeId: store.id, sourceType, sourceId: store.id }
        : null;
    }

    const row = entity as Product | Category | Faq;
    return row.id && row.storeId
      ? { storeId: row.storeId, sourceType, sourceId: row.id }
      : null;
  }
}

/**
 * True only when the entity carries the flag *and* it says hidden — an entity
 * loaded without the column must not be mistaken for a hidden one.
 */
function isDefinitelyHidden(entity: IndexedEntity): boolean {
  if (entity instanceof Product) {
    return (
      entity.status !== undefined && entity.status !== ProductStatus.Active
    );
  }
  if (entity instanceof Category || entity instanceof Faq) {
    return entity.isPublished === false;
  }
  return false;
}
