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
import { MailboxConnectionStatus } from '../enums/mailbox-connection-status.enum';
import { MailboxProviderName } from '../mailbox/mailbox.provider';
import {
  MAILBOX_ACCOUNT_EMAIL_MAX_LENGTH,
  MAILBOX_CURSOR_MAX_LENGTH,
  MAILBOX_ERROR_MAX_LENGTH,
} from '../suppliers.constants';

/**
 * One store's connected mailbox: the grant that lets a request be sent **as the
 * owner**, and the watermark that says how far its replies have been read.
 *
 * One row per store, which is why `storeId` is uniquely indexed rather than
 * merely indexed. An owner has one mailbox; two rows would mean two watermarks
 * over the same threads and a reply ingested twice.
 *
 * The table is deliberately **not** called `gmail_connections`. Gmail is the
 * first adapter behind `MailboxProvider` and the two known to be coming — Graph
 * for Outlook, IMAP for a cPanel mailbox — would each need this row and none of
 * its Google-specific names. A `historyId` column would have been the same
 * mistake: the watermark is stored as an opaque `syncCursor`, because only the
 * adapter knows what one means.
 */
@Entity('mailbox_connections')
@Index('UQ_mailbox_connections_store', ['storeId'], { unique: true })
export class MailboxConnection {
  @PrimaryColumn('uuid')
  id!: string;

  // `@ManyToOne` with an explicit unique index rather than `@OneToOne`, which
  // would add a second, auto-named unique constraint on the same column beside
  // the one declared above it. Same guarantee, one index, and the name says why
  // it exists.
  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  @Column({
    type: 'enum',
    enum: MailboxProviderName,
    default: MailboxProviderName.Gmail,
  })
  provider!: MailboxProviderName;

  /** The mailbox this grant is for, shown in the dashboard so an owner can see
   *  which of their addresses the requests go out from. */
  @Column({ type: 'varchar', length: MAILBOX_ACCOUNT_EMAIL_MAX_LENGTH })
  accountEmail!: string;

  /**
   * The refresh token, **encrypted** — AES-256-GCM under
   * `MAILBOX_TOKEN_ENCRYPTION_KEY`, never the token itself.
   *
   * `select: false`, for the reason `User.password` is: this is the one column in
   * the project that is a key to property belonging to somebody outside the
   * company, and a `find` that returns the whole row by default is how it ends
   * up in a log line. The service that needs it asks for it explicitly.
   */
  @Column({ type: 'text', select: false })
  refreshTokenCipher!: string;

  /** What Google actually granted, which is not always what was asked for. */
  @Column({ type: 'simple-array', default: '' })
  scopes!: string[];

  /**
   * The sync watermark, opaque by design: Gmail's `historyId`, Graph's delta
   * token and an IMAP `UID` are three different things answering one question.
   *
   * Advanced only **after** the replies of a pass are committed. Saving it first
   * and then failing would skip a supplier's reply permanently, which is the one
   * failure this feature cannot recover from on its own.
   */
  @Column({
    type: 'varchar',
    length: MAILBOX_CURSOR_MAX_LENGTH,
    nullable: true,
  })
  syncCursor!: string | null;

  @Column({
    type: 'enum',
    enum: MailboxConnectionStatus,
    default: MailboxConnectionStatus.Connected,
  })
  status!: MailboxConnectionStatus;

  @Column({ type: 'timestamp', nullable: true })
  lastSyncedAt!: Date | null;

  /** The last failure, for the dashboard. Truncated: it is a hint, not a log. */
  @Column({ type: 'varchar', length: MAILBOX_ERROR_MAX_LENGTH, nullable: true })
  lastError!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  connectedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
