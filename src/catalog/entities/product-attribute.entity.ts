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
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Store } from '../../site-builder/entities/store.entity';
import { AttributeDisplayStyle } from '../enums/attribute-display-style.enum';
import { ProductAttributeValue } from './product-attribute-value.entity';

/**
 * A facet this store defines for itself — "Size", "Colour", "Material". The
 * platform cannot hardcode product columns because it does not know what its
 * stores sell, so the columns become rows.
 *
 * `key` is separate from `name` for the same reason `Category.slug` is separate
 * from `Category.name`: the name is customer-facing copy the owner will
 * re-word, the key is an address that appears in bookmarked URLs. Renaming
 * "Size" to "Sizing" must not break `?attributes=size:xl`.
 */
@Entity('product_attributes')
@Index('UQ_product_attributes_store_key', ['storeId', 'key'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('IDX_product_attributes_store_position', ['storeId', 'position'])
export class ProductAttribute {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  /** Display label — "Size". */
  @Column()
  name!: string;

  /** URL/API token — `size`. Unique per store. */
  @Column()
  key!: string;

  /**
   * Whether picking a value produces a distinct SKU, price and stock (Size,
   * Colour) or merely describes the whole product (Material, Brand).
   *
   * Immutable after creation — flipping it is a data migration wearing a
   * boolean's clothes, so `UpdateAttributeDto` does not carry the field.
   */
  @Column({ default: false })
  isVariantAxis!: boolean;

  /** Whether the storefront sidebar offers it as a filter. */
  @Column({ default: true })
  isFilterable!: boolean;

  /** Whether the product detail page lists it in its spec table. */
  @Column({ default: true })
  showOnProductPage!: boolean;

  @Column({
    type: 'enum',
    enum: AttributeDisplayStyle,
    default: AttributeDisplayStyle.List,
  })
  displayStyle!: AttributeDisplayStyle;

  /** Owner-defined sidebar order within the store. */
  @Column({ type: 'int', default: 0 })
  position!: number;

  @OneToMany(() => ProductAttributeValue, (value) => value.attribute, {
    cascade: ['insert'],
  })
  values!: ProductAttributeValue[];

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
