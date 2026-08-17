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
import { DEFAULT_SUPPLIER_LEAD_TIME_DAYS } from '../../advisor/advisor.constants';
import { Store } from '../../site-builder/entities/store.entity';
import {
  SUPPLIER_EMAIL_MAX_LENGTH,
  SUPPLIER_NAME_MAX_LENGTH,
  SUPPLIER_NOTES_MAX_LENGTH,
  SUPPLIER_PHONE_MAX_LENGTH,
} from '../suppliers.constants';

/**
 * One of a store's suppliers: a name, an address to write to, and what the
 * owner has learned about dealing with them.
 *
 * Soft-deleted, unlike `Faq` and like `Category` and `Product` — a purchase
 * request points at this row, and an owner removing a supplier must not take
 * last quarter's deals with them. The offer keeps its own snapshot of the name
 * and the email, so a deleted supplier still renders in history; the soft
 * delete is what keeps the link itself intact for reporting.
 */
@Entity('suppliers')
@Index('IDX_suppliers_store_name', ['storeId', 'name'])
@Index('UQ_suppliers_store_email', ['storeId', 'contactEmail'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class Supplier {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  @Column({ type: 'varchar', length: SUPPLIER_NAME_MAX_LENGTH })
  name!: string;

  /** Lowercased on write, and unique per store while the row is alive. */
  @Column({ type: 'varchar', length: SUPPLIER_EMAIL_MAX_LENGTH })
  contactEmail!: string;

  @Column({
    type: 'varchar',
    length: SUPPLIER_PHONE_MAX_LENGTH,
    nullable: true,
  })
  phone!: string | null;

  /**
   * This supplier's own delivery estimate, which is what a request is racing.
   * `AdvisorSettings.leadTimeDays` stays store-wide until a supplier is linked
   * to a product — see the spec's Deferred.
   */
  @Column({ type: 'int', default: DEFAULT_SUPPLIER_LEAD_TIME_DAYS })
  leadTimeDays!: number;

  /**
   * The owner's own notes — "they deliver late", "ask for Mahmoud". Read by the
   * drafting prompt, which is the whole reason the field is here rather than in
   * the owner's head.
   */
  @Column({
    type: 'varchar',
    length: SUPPLIER_NOTES_MAX_LENGTH,
    nullable: true,
  })
  notes!: string | null;

  /** Inactive hides a supplier from the picker without losing the contact. */
  @Column({ default: true })
  isActive!: boolean;

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
