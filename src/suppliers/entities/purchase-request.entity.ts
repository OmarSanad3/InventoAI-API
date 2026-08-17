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
import { Product } from '../../catalog/entities/product.entity';
import { ProductVariant } from '../../catalog/entities/product-variant.entity';
import { Store } from '../../site-builder/entities/store.entity';
import { DraftStatus } from '../enums/draft-status.enum';
import { PurchaseRequestStatus } from '../enums/purchase-request-status.enum';
import {
  REQUEST_NOTE_MAX_LENGTH,
  REQUEST_SUBJECT_MAX_LENGTH,
} from '../suppliers.constants';
import { SupplierOffer } from './supplier-offer.entity';

/**
 * "We need 18 more of these — who can supply them, and when?"
 *
 * The product and the variant are **snapshotted**, the same rule `OrderItem`
 * follows: a request that was sent said what it said, and renaming or deleting
 * the product afterwards must not rewrite the email a supplier is holding.
 * `productId` and `variantId` are links back for reporting only, and both go
 * null rather than take the request with them.
 *
 * Never deleted, only cancelled — it is a record of money the store was about
 * to spend.
 */
@Entity('purchase_requests')
@Index('IDX_purchase_requests_store_created', ['storeId', 'createdAt'])
export class PurchaseRequest {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  @ManyToOne(() => Product, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'productId' })
  product!: Product | null;

  @Column({ type: 'uuid', nullable: true })
  productId!: string | null;

  @ManyToOne(() => ProductVariant, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'variantId' })
  variant!: ProductVariant | null;

  @Column({ type: 'uuid', nullable: true })
  variantId!: string | null;

  @Column({ type: 'varchar', length: 255 })
  productTitle!: string;

  /** `"Size: M, Colour: Navy"`, or null for a product sold one way. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  variantLabel!: string | null;

  @Column({ type: 'int' })
  quantity!: number;

  /**
   * The deadline an offer is judged against. Null means the owner set none, so
   * no offer can be late — `rankOffers` then sorts on price and speed alone.
   */
  @Column({ type: 'int', nullable: true })
  neededWithinDays!: number | null;

  @Column({ type: 'varchar', length: REQUEST_SUBJECT_MAX_LENGTH })
  subject!: string;

  /** Plain text. Mailed HTML-escaped into the branded shell. */
  @Column('text')
  body!: string;

  /** The owner's steer for the draft — "ask about bulk pricing". */
  @Column({ type: 'varchar', length: REQUEST_NOTE_MAX_LENGTH, nullable: true })
  note!: string | null;

  @Column({
    type: 'enum',
    enum: PurchaseRequestStatus,
    default: PurchaseRequestStatus.Draft,
  })
  status!: PurchaseRequestStatus;

  /** Which writer produced `body` — the model, or the template underneath it. */
  @Column({ type: 'enum', enum: DraftStatus, default: DraftStatus.Fallback })
  draftStatus!: DraftStatus;

  @Column({ type: 'timestamp', nullable: true })
  sentAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  confirmedAt!: Date | null;

  /** The deal. Set by `confirm` and by nothing else. */
  @Column({ type: 'uuid', nullable: true })
  confirmedOfferId!: string | null;

  @OneToMany(() => SupplierOffer, (offer) => offer.purchaseRequest)
  offers!: SupplierOffer[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
