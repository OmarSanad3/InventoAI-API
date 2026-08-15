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
} from 'typeorm';
import { Product } from '../../catalog/entities/product.entity';
import { ProductVariant } from '../../catalog/entities/product-variant.entity';
import { Order } from './order.entity';

/**
 * One line of an order, **snapshotted** at purchase time.
 *
 * The snapshot columns are the point of this table: repricing a product must not
 * rewrite history, and deleting one must not blank an old order. `productId` and
 * `variantId` are links back for reporting, nothing more — every field the
 * frontend renders is stored here.
 */
@Entity('order_items')
@Index('IDX_order_items_order', ['orderId'])
@Index('IDX_order_items_variant', ['variantId'])
export class OrderItem {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order!: Order;

  @Column('uuid')
  orderId!: string;

  /** Null only if the product row is ever hard-deleted; the snapshot survives it. */
  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'productId' })
  product!: Product | null;

  @Column({ type: 'uuid', nullable: true })
  productId!: string | null;

  @ManyToOne(() => ProductVariant, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'variantId' })
  variant!: ProductVariant | null;

  @Column({ type: 'uuid', nullable: true })
  variantId!: string | null;

  @Column()
  productTitle!: string;

  /** Lets the frontend link back to the product page, even after a rename. */
  @Column()
  productSlug!: string;

  @Column({ type: 'varchar', nullable: true })
  productImageUrl!: string | null;

  /**
   * `{ "Size": "M", "Colour": "Red" }` — **labels, not ids**, and the one place
   * in the catalog where storing attribute text rather than referencing it is
   * correct. Renaming the value "M" to "Medium" should follow every live
   * product and no past order; ids would make the order follow too.
   *
   * `{}` for a simple product, whose lone default variant has no options.
   */
  @Column({ type: 'jsonb', default: {} })
  variantOptions!: Record<string, string>;

  /** Snapshot of the **variant's** sku. */
  @Column({ type: 'varchar', nullable: true })
  sku!: string | null;

  /** Snapshot of `ProductVariant.priceAmount`, in minor units. */
  @Column({ type: 'int' })
  unitAmount!: number;

  @Column({ type: 'int' })
  quantity!: number;

  /** `unitAmount * quantity`, stored so a total never needs recomputing. */
  @Column({ type: 'int' })
  lineTotalAmount!: number;

  /**
   * The line's place in the cart as it was submitted. Every line of an order is
   * written in one statement, so `createdAt` is identical across them and cannot
   * order the list — without this column an order would render its lines in
   * whatever order Postgres happened to return.
   */
  @Column({ type: 'int', default: 0 })
  position!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
