import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Store } from '../../site-builder/entities/store.entity';
import { User } from '../../users/entities/user.entity';
import { OrderStatus } from '../enums/order-status.enum';
import { PaymentMethod } from '../enums/payment-method.enum';
import { PaymentStatus } from '../enums/payment-status.enum';
import {
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_PHONE_MAX_LENGTH,
  DEFAULT_SHIPPING_FEE,
  MAX_CANCEL_REASON_LENGTH,
} from '../orders.constants';
import type { ShippingAddress } from '../types/shipping-address';
import { OrderItem } from './order-item.entity';

/**
 * What a customer bought, at the prices and quantities the server decided.
 *
 * **No soft delete.** An order is a financial record: it is cancelled, never
 * removed. The contact details are snapshotted rather than read through
 * `userId` so an order still renders after the account behind it is gone — and
 * so guest checkout, if it ever lands, needs a route and a DTO rather than a
 * schema change.
 */
@Entity('orders')
@Index('UQ_orders_store_number', ['storeId', 'orderNumber'], { unique: true })
@Index('IDX_orders_store_status', ['storeId', 'status'])
@Index('IDX_orders_user', ['userId'])
export class Order {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  /**
   * Per-store and human-readable — "order #1042". Taken from
   * `Store.nextOrderNumber` by one `UPDATE ... RETURNING` inside the checkout
   * transaction, which is what makes it gapless under concurrent checkouts.
   */
  @Column({ type: 'int' })
  orderNumber!: number;

  /**
   * The buyer. Nullable for the guest path that does not exist yet, and
   * `SET NULL` rather than `CASCADE`: deleting an account must not delete the
   * store's sales history.
   */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'varchar', length: CONTACT_NAME_MAX_LENGTH })
  contactName!: string;

  @Column({ type: 'varchar', length: CONTACT_EMAIL_MAX_LENGTH })
  contactEmail!: string;

  @Column({ type: 'varchar', length: CONTACT_PHONE_MAX_LENGTH })
  contactPhone!: string;

  @Column('jsonb')
  shippingAddress!: ShippingAddress;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.Pending })
  status!: OrderStatus;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.Unpaid })
  paymentStatus!: PaymentStatus;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.Cod })
  paymentMethod!: PaymentMethod;

  /** Copied from `Store.currency` at creation, so a later switch cannot rewrite history. */
  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  /** Minor units, like every amount in the project. Sum of the line totals. */
  @Column({ type: 'int' })
  subtotalAmount!: number;

  @Column({ type: 'int', default: DEFAULT_SHIPPING_FEE })
  shippingFee!: number;

  /** `subtotalAmount + shippingFee`, stored so a total never needs recomputing. */
  @Column({ type: 'int' })
  totalAmount!: number;

  /** "Leave it with the doorman" — written by the customer at checkout. */
  @Column({ type: 'text', nullable: true })
  customerNote!: string | null;

  /** Owner-only. Never mapped onto a customer-facing DTO. */
  @Column({ type: 'text', nullable: true })
  internalNote!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt!: Date | null;

  @Column({ type: 'varchar', length: MAX_CANCEL_REASON_LENGTH, nullable: true })
  cancelReason!: string | null;

  @OneToMany(() => OrderItem, (item) => item.order)
  items!: OrderItem[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
