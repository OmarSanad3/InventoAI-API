import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Store } from '../../site-builder/entities/store.entity';
import {
  ADVISOR_CITY_MAX_LENGTH,
  ADVISOR_DEFAULT_SEND_HOUR,
  ADVISOR_TIMEZONE_MAX_LENGTH,
  DEFAULT_SUPPLIER_LEAD_TIME_DAYS,
} from '../advisor.constants';

/**
 * One store's Advisor configuration, created lazily on the dashboard's own read
 * — exactly as `ChatbotSettings` is, and for the same reason: the scheduler
 * reads this table for every live store every hour, and a read that writes
 * would create a row per store on its first night.
 *
 * A table of its own rather than more columns on `Store`: `Store` is the
 * site-builder's entity and already carries the branding, the slug, the currency
 * and the order numbering.
 */
@Entity('advisor_settings')
@Index('IDX_advisor_settings_store', ['storeId'], { unique: true })
export class AdvisorSettings {
  @PrimaryColumn('uuid')
  id!: string;

  @OneToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  /** False means no brief is generated at all — not a brief nobody is mailed. */
  @Column({ type: 'boolean', default: true })
  isEnabled!: boolean;

  @Column({ type: 'boolean', default: true })
  emailEnabled!: boolean;

  /** The store's **local** hour, 0–23. The cron runs hourly and checks it. */
  @Column({ type: 'int', default: ADVISOR_DEFAULT_SEND_HOUR })
  sendHour!: number;

  /**
   * An IANA zone name, validated against `Intl.supportedValuesOf('timeZone')`
   * on write. It decides both when the brief is generated and what "today" and
   * "the last 7 days" mean — a store in Cairo must not have its day cut at
   * 02:00 by a UTC boundary.
   *
   * Nullable rather than defaulted in the column, so `ADVISOR_DEFAULT_TIMEZONE`
   * stays the single source of the fallback.
   */
  @Column({
    type: 'varchar',
    length: ADVISOR_TIMEZONE_MAX_LENGTH,
    nullable: true,
  })
  timezone!: string | null;

  /** ISO-3166 alpha-2, uppercase. Selects the fixed-date calendar events. */
  @Column({ type: 'varchar', length: 2, nullable: true })
  countryCode!: string | null;

  /** Display only — the forecast is fetched with the coordinates. */
  @Column({ type: 'varchar', length: ADVISOR_CITY_MAX_LENGTH, nullable: true })
  city!: string | null;

  /**
   * Both or neither, enforced by the DTO. Unset means the store gets no weather
   * section and the Advisor makes no outbound request on its behalf — a signal
   * that cannot be computed is absent, never guessed.
   */
  @Column({ type: 'double precision', nullable: true })
  latitude!: number | null;

  @Column({ type: 'double precision', nullable: true })
  longitude!: number | null;

  /**
   * Store-wide until `Supplier` exists, and the seam feature 9 fills: a restock
   * has to beat the delivery it is racing.
   */
  @Column({ type: 'int', default: DEFAULT_SUPPLIER_LEAD_TIME_DAYS })
  leadTimeDays!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
