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
import { OfferExtractionStatus } from '../enums/offer-extraction-status.enum';
import { SupplierOfferStatus } from '../enums/supplier-offer-status.enum';
import {
  MAILBOX_PROVIDER_ID_MAX_LENGTH,
  OFFER_NOTES_MAX_LENGTH,
  SUPPLIER_EMAIL_MAX_LENGTH,
  SUPPLIER_NAME_MAX_LENGTH,
} from '../suppliers.constants';
import { PurchaseRequest } from './purchase-request.entity';
import { Supplier } from './supplier.entity';

/**
 * One supplier's side of a request — and, before they answer, the record that
 * they were asked at all.
 *
 * **There is no recipients table.** Sending creates one of these per recipient
 * with `status: awaiting` and no numbers, and a reply fills them in. One table
 * fewer, and "who did we ask, and who has answered" is one query.
 *
 * The supplier's name and email are snapshotted here, as `OrderItem` snapshots
 * a product: a deleted supplier must not take the name of who offered what out
 * of a deal the owner already closed.
 *
 * `totalAmount` is deliberately **not** a column. It is `unitAmount ×
 * quantity`, it belongs in the DTO, and a stored copy would be a denormalised
 * number with no single writer.
 */
@Entity('supplier_offers')
@Index('IDX_supplier_offers_request', ['purchaseRequestId'])
@Index('IDX_supplier_offers_store', ['storeId'])
// The sync's own lookup: a thread id off the wire, back to the offer it belongs
// to. Not unique — a send that was retried can reuse a thread.
@Index('IDX_supplier_offers_thread', ['mailboxThreadId'])
// Unique, because it is an idempotency key: the same inbound message must not be
// read into an offer twice. Postgres allows many NULLs in a unique index, which
// is what keeps every SMTP-sent offer out of its way.
@Index('UQ_supplier_offers_mailbox_message', ['mailboxMessageId'], {
  unique: true,
  where: '"mailboxMessageId" IS NOT NULL',
})
export class SupplierOffer {
  @PrimaryColumn('uuid')
  id!: string;

  /** Denormalised from the request so every read is scoped without a join. */
  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  @ManyToOne(() => PurchaseRequest, (request) => request.offers, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'purchaseRequestId' })
  purchaseRequest!: PurchaseRequest;

  @Column('uuid')
  purchaseRequestId!: string;

  @ManyToOne(() => Supplier, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'supplierId' })
  supplier!: Supplier | null;

  @Column({ type: 'uuid', nullable: true })
  supplierId!: string | null;

  @Column({ type: 'varchar', length: SUPPLIER_NAME_MAX_LENGTH })
  supplierName!: string;

  @Column({ type: 'varchar', length: SUPPLIER_EMAIL_MAX_LENGTH })
  supplierEmail!: string;

  @Column({
    type: 'enum',
    enum: SupplierOfferStatus,
    default: SupplierOfferStatus.Awaiting,
  })
  status!: SupplierOfferStatus;

  /** **Minor units**, in `Store.currency`. Null until somebody quotes a price. */
  @Column({ type: 'int', nullable: true })
  unitAmount!: number | null;

  /** What the supplier offered, which is not always what was asked for. */
  @Column({ type: 'int', nullable: true })
  quantity!: number | null;

  @Column({ type: 'int', nullable: true })
  deliveryDays!: number | null;

  @Column({ type: 'varchar', length: OFFER_NOTES_MAX_LENGTH, nullable: true })
  notes!: string | null;

  /** Stored **before** the model is called, so no reply is lost to a parse. */
  @Column({ type: 'text', nullable: true })
  rawReply!: string | null;

  @Column({ type: 'enum', enum: OfferExtractionStatus, nullable: true })
  extractionStatus!: OfferExtractionStatus | null;

  /**
   * The mail thread this request opened, captured **at send time** — and the
   * whole reason automatic ingestion is a lookup rather than a guess.
   *
   * The alternative was a `[PR-1234]` token in the subject line, matched with a
   * regular expression against whatever a supplier's mail client did to it. This
   * is a primary key. Null when the request was sent over SMTP, which is every
   * store that has connected no mailbox.
   */
  @Column({
    type: 'varchar',
    length: MAILBOX_PROVIDER_ID_MAX_LENGTH,
    nullable: true,
  })
  mailboxThreadId!: string | null;

  /**
   * The last inbound message read into this offer, and the idempotency key of
   * `SupplierReplyService.ingest`.
   *
   * A human pastes once; a sync retries — a history page can be re-delivered,
   * and a watermark that expires makes every known thread be re-read from the
   * start. Without this, that would re-run Gemini over a price the owner may
   * since have corrected by hand.
   */
  @Column({
    type: 'varchar',
    length: MAILBOX_PROVIDER_ID_MAX_LENGTH,
    nullable: true,
  })
  mailboxMessageId!: string | null;

  /** Null means this recipient has never been mailed — which is what makes
   *  `POST /send` idempotent and re-sendable after a failure. */
  @Column({ type: 'timestamp', nullable: true })
  sentAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  repliedAt!: Date | null;

  /** When this offer was won or declined. */
  @Column({ type: 'timestamp', nullable: true })
  decidedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
