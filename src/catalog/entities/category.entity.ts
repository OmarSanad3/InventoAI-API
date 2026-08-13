import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToMany,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Store } from '../../site-builder/entities/store.entity';
import { Product } from './product.entity';

/**
 * A store-defined navigation facet. Flat — there is no `parentId` — and scoped
 * to exactly one store.
 *
 * The unique index is partial on purpose: without `WHERE "deletedAt" IS NULL`,
 * soft-deleting `summer-sale` would burn that slug for the store forever.
 */
@Entity('categories')
@Index('UQ_categories_store_slug', ['storeId', 'slug'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_categories_store_position', ['storeId', 'position'])
export class Category {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  @Column()
  name!: string;

  @Column()
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', nullable: true })
  imageUrl!: string | null;

  @Column({ type: 'varchar', nullable: true })
  imagePublicId!: string | null;

  /** Owner-defined display order within the store. */
  @Column({ type: 'int', default: 0 })
  position!: number;

  @Column({ default: true })
  isPublished!: boolean;

  @Column({ default: false })
  isFeatured!: boolean;

  /** A product belongs to many categories — a mug is in "Kitchen" and "Gifts". */
  @ManyToMany(() => Product, (product) => product.categories)
  products!: Product[];

  /**
   * Not a column. `CategoryService` fills it from one grouped count so the
   * response DTOs can carry the number without a query per row; it is `0` on a
   * category that was loaded without one.
   */
  productCount?: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
