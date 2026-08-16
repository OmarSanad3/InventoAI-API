import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Store } from '../../site-builder/entities/store.entity';
import { KnowledgeSourceType } from '../enums/knowledge-source-type.enum';

/**
 * One embeddable document, composed from a source row the storefront already
 * shows. The vector itself is **not** here: it lives in `knowledge_embeddings`,
 * a table TypeORM does not manage, because `synchronize` has no `vector` type
 * and would fight anything that pretended otherwise.
 *
 * The pleasant consequence is that this table is ordinary columns only, so the
 * application boots and synchronizes with or without pgvector installed —
 * missing extension degrades retrieval to lexical, it does not break the API.
 *
 * `content` is stored rather than only hashed for three reasons: the sweeper
 * needs it to embed, retrieval returns it as the snippet, and it is the only way
 * to answer "why did it match that" without re-deriving the composition.
 */
@Entity('knowledge_documents')
@Index('UQ_knowledge_source', ['storeId', 'sourceType', 'sourceId'], {
  unique: true,
})
@Index('IDX_knowledge_store_stale', ['storeId', 'isStale'])
export class KnowledgeDocument {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  @Column({ type: 'enum', enum: KnowledgeSourceType })
  sourceType!: KnowledgeSourceType;

  /** The source row's id — the store's own id for a `store_profile`. */
  @Column('uuid')
  sourceId!: string;

  @Column({ type: 'text', default: '' })
  content!: string;

  /** SHA-256 of `content`. Equal hash, no embedding call. */
  @Column({ type: 'varchar', length: 64, default: '' })
  contentHash!: string;

  /** The source changed; the stored vector may no longer describe it. */
  @Column({ default: true })
  isStale!: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  embeddingModel!: string | null;

  /** `null` means it has never been embedded, not that it is out of date. */
  @Column({ type: 'timestamp', nullable: true })
  indexedAt!: Date | null;

  /** Past `MAX_INDEX_FAILURES` the sweeper stops retrying and status reports it. */
  @Column({ type: 'int', default: 0 })
  failureCount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
