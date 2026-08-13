import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Store } from '../../site-builder/entities/store.entity';
import {
  PRODUCT_CATEGORIES_TABLE,
  PRODUCT_DESCRIPTIVE_VALUES_TABLE,
  SEARCH_TEXT_CONFIG,
} from '../catalog.constants';
import { ProductStatus } from '../enums/product-status.enum';
import { Category } from './category.entity';
import { ProductAttributeValue } from './product-attribute-value.entity';
import { ProductImage } from './product-image.entity';
import { ProductVariant } from './product-variant.entity';

/**
 * The `tsvector` Postgres maintains for us. It is a **generated, stored** column
 * rather than something the application writes, so it cannot drift from the row
 * and there is no indexing job to keep alive.
 *
 * The weights *are* the ranking: a title match must beat a description match,
 * and `A`–`D` is what tells `ts_rank_cd` so. The config has to be the literal
 * `SEARCH_TEXT_CONFIG` because a generated expression must be `IMMUTABLE`, which
 * rules out reading `Store.locale`.
 */
const SEARCH_VECTOR_EXPRESSION = `setweight(to_tsvector('${SEARCH_TEXT_CONFIG}', coalesce("title", '')), 'A') || setweight(to_tsvector('${SEARCH_TEXT_CONFIG}', coalesce("searchKeywords", '')), 'B') || setweight(to_tsvector('${SEARCH_TEXT_CONFIG}', coalesce("shortDescription", '')), 'C') || setweight(to_tsvector('${SEARCH_TEXT_CONFIG}', coalesce("description", '')), 'D')`;

/**
 * What a store sells. Price, SKU and stock are deliberately **not** here: they
 * live on `ProductVariant`, and every product has at least one variant even when
 * it is sold in exactly one form. That is what keeps checkout, stock and order
 * snapshots from forking into a simple-versus-variable pair of code paths.
 */
@Entity('products')
@Index('UQ_products_store_slug', ['storeId', 'slug'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_products_store_status', ['storeId', 'status'])
@Index('IDX_products_store_price', ['storeId', 'minPriceAmount'])
export class Product {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  @Column()
  title!: string;

  @Column()
  slug!: string;

  /** Long copy for the detail page. */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Card copy for the listing. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  shortDescription!: string | null;

  /**
   * Owner-supplied synonyms — `sneakers, trainers, kicks`, or the Arabic name of
   * an English-titled product. Weight `B`, just under the title. This is the
   * store-builder answer to synonyms: the platform cannot ship a dictionary
   * because it does not know whether a store sells shoes or ceramics.
   */
  @Column({ type: 'varchar', length: 200, nullable: true })
  searchKeywords!: string | null;

  /** `select: false` for the same reason `User.password` has it — machinery. */
  @Column({
    type: 'tsvector',
    select: false,
    asExpression: SEARCH_VECTOR_EXPRESSION,
    generatedType: 'STORED',
    nullable: true,
  })
  searchVector!: string;

  @Column({
    type: 'enum',
    enum: ProductStatus,
    default: ProductStatus.Draft,
  })
  status!: ProductStatus;

  @Column({ default: false })
  isFeatured!: boolean;

  /** Reserved for shipping rules; nothing reads it yet. */
  @Column({ type: 'int', nullable: true })
  weightGrams!: number | null;

  /** Owner-defined merchandising order within the store. */
  @Column({ type: 'int', default: 0 })
  position!: number;

  /**
   * The four denormalised aggregates. They exist because the storefront's
   * hottest query sorts and filters by price across pages, and an aggregate in
   * `ORDER BY` cannot use an index.
   *
   * **`ProductService.recalculateAggregates` is the only writer.** Every code
   * path that touches a variant calls it inside the same transaction; nothing
   * else may assign these.
   */
  @Column({ type: 'int', default: 0 })
  minPriceAmount!: number;

  @Column({ type: 'int', default: 0 })
  maxPriceAmount!: number;

  @Column({ type: 'int', default: 0 })
  totalStock!: number;

  @Column({ type: 'int', default: 0 })
  variantCount!: number;

  @OneToMany(() => ProductVariant, (variant) => variant.product)
  variants!: ProductVariant[];

  @OneToMany(() => ProductImage, (image) => image.product)
  images!: ProductImage[];

  @ManyToMany(() => Category, (category) => category.products)
  @JoinTable({
    name: PRODUCT_CATEGORIES_TABLE,
    joinColumn: { name: 'productId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'categoryId', referencedColumnName: 'id' },
  })
  categories!: Category[];

  /**
   * **Descriptive** attribute values only — Material, Brand. Values of an
   * attribute flagged `isVariantAxis` belong on the variant instead, and putting
   * Size here is a 400 rather than a quiet accept.
   */
  @ManyToMany(() => ProductAttributeValue)
  @JoinTable({
    name: PRODUCT_DESCRIPTIVE_VALUES_TABLE,
    joinColumn: { name: 'productId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'attributeValueId', referencedColumnName: 'id' },
  })
  attributeValues!: ProductAttributeValue[];

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
