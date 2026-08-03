import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProductAttribute } from './product-attribute.entity';

/**
 * One entry of an attribute's controlled vocabulary — "XL" under "Size".
 *
 * Products reference it by **id**, never by text, which is what makes renaming
 * "XL" to "Extra Large" a single `UPDATE` instead of a rewrite of every product,
 * and what stops a sidebar rendering `XL`, `xl` and `X-Large` as three filters
 * that each match one product.
 */
@Entity('product_attribute_values')
@Index('UQ_attribute_values_attribute_slug', ['attributeId', 'slug'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_attribute_values_store', ['storeId'])
export class ProductAttributeValue {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => ProductAttribute, (attribute) => attribute.values, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'attributeId' })
  attribute!: ProductAttribute;

  @Column('uuid')
  attributeId!: string;

  /**
   * Denormalised from the parent. Every storefront filter query joins from
   * products to values and must be store-scoped; carrying the id saves a join
   * to `product_attributes` on the hottest query in the catalog. Written once
   * at insert and never edited — the parent's `storeId` is immutable too, so
   * the two cannot drift.
   */
  @Column('uuid')
  storeId!: string;

  /** Display text — "Extra Large". */
  @Column()
  value!: string;

  /** URL token — `extra-large`. Unique per attribute. */
  @Column()
  slug!: string;

  /** `#RRGGBB`, and only when the attribute's style is `swatch`. */
  @Column({ type: 'varchar', length: 7, nullable: true })
  swatchHex!: string | null;

  /**
   * Order within the facet. It matters more than it looks: sizes sort S, M, L,
   * XL — an ordering neither an alphabetical nor a numeric sort produces.
   */
  @Column({ type: 'int', default: 0 })
  position!: number;

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
