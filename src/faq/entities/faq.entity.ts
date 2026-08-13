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
import { FAQ_QUESTION_MAX_LENGTH } from '../faq.constants';

/**
 * One question-and-answer pair on a store's `/SITENAME/faq` page, owned and
 * ordered by the owner.
 *
 * No soft delete and no slug, unlike `Category` and `Product`: nothing points
 * at an FAQ row — no order snapshots it, no URL addresses it — so there is
 * nothing to preserve and a hard delete is honest.
 *
 * `answer` is plain text and is rendered as text by the storefront. The project
 * has no HTML sanitiser, so accepting markup here would be stored XSS on the
 * platform's own domain.
 */
@Entity('faqs')
@Index('IDX_faqs_store_position', ['storeId', 'position'])
export class Faq {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  @Column({ type: 'varchar', length: FAQ_QUESTION_MAX_LENGTH })
  question!: string;

  @Column('text')
  answer!: string;

  /** Owner-defined display order within the store. */
  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ default: true })
  isPublished!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
