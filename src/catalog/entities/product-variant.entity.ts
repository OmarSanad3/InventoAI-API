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
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { VARIANT_ATTRIBUTE_VALUES_TABLE } from '../catalog.constants';
import { Product } from './product.entity';
import { ProductAttributeValue } from './product-attribute-value.entity';

/**
 * One buyable form of a product — "Red / M" at its own price and stock. A
 * product sold in exactly one form still has one of these, flagged `isDefault`
 * with no attribute values, so nothing downstream needs to ask whether this
 * product "has variants".
 */
@Entity('product_variants')
@Index('UQ_variants_product_options', ['productId', 'optionsKey'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
@Index('UQ_variants_store_sku', ['storeId', 'sku'], {
  unique: true,
  where: '"deletedAt" IS NULL AND "sku" IS NOT NULL',
})
@Index('IDX_variants_product', ['productId'])
export class ProductVariant {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Product, (product) => product.variants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'productId' })
  product!: Product;

  @Column('uuid')
  productId!: string;

  /** Denormalised from the parent — every stock update is store-scoped. */
  @Column('uuid')
  storeId!: string;

  /** The owner's own code. Unique per store when present. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  sku!: string | null;

  /** Minor units: `24900` is 249.00 in the store's currency. Never a float. */
  @Column({ type: 'int' })
  priceAmount!: number;

  /** The struck-through "was" price. Must exceed `priceAmount` to be honest. */
  @Column({ type: 'int', nullable: true })
  compareAtAmount!: number | null;

  /**
   * Never negative: the order module decrements it with a conditional update
   * that simply affects zero rows when the stock is not there.
   */
  @Column({ type: 'int', default: 0 })
  stockQuantity!: number;

  /** Dashboard warning only — nothing reorders on it yet. */
  @Column({ type: 'int', default: 0 })
  lowStockThreshold!: number;

  /**
   * The variant's attribute-value ids, sorted and joined with `:`. A unique
   * index cannot span a join table, so the combination is materialised here and
   * `UQ_variants_product_options` turns the race between two dashboard tabs into
   * a `23505` instead of a duplicate the shopper adds to their cart.
   *
   * `''` for a default variant, which the same index makes unique — a product
   * cannot have two defaults.
   */
  @Column({ default: '' })
  optionsKey!: string;

  @Column({ default: false })
  isDefault!: boolean;

  /** Order in the picker. */
  @Column({ type: 'int', default: 0 })
  position!: number;

  @ManyToMany(() => ProductAttributeValue)
  @JoinTable({
    name: VARIANT_ATTRIBUTE_VALUES_TABLE,
    joinColumn: { name: 'variantId', referencedColumnName: 'id' },
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
