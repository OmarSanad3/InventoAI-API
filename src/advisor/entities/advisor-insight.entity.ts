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
import {
  INSIGHT_DEDUPE_KEY_MAX_LENGTH,
  INSIGHT_TITLE_MAX_LENGTH,
} from '../advisor.constants';
import { AdvisorInsightKind } from '../enums/advisor-insight-kind.enum';
import { AdvisorInsightStatus } from '../enums/advisor-insight-status.enum';
import { AdvisorSeverity } from '../enums/advisor-severity.enum';
import { AdvisorBrief } from './advisor-brief.entity';

/**
 * One line of a brief: the numbers a collector measured, and the sentence
 * something wrote about them.
 *
 * The split is the point. `payload` is what the platform knows and `title` /
 * `body` are how it was said — so a model can rewrite the wording every day
 * without ever moving a figure, and the dashboard can render the number from
 * the payload rather than parse it back out of the prose.
 */
@Entity('advisor_insights')
@Index('IDX_advisor_insights_brief', ['briefId'])
@Index('IDX_advisor_insights_store_key_status', [
  'storeId',
  'dedupeKey',
  'status',
])
export class AdvisorInsight {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => AdvisorBrief, (brief) => brief.insights, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'briefId' })
  brief!: AdvisorBrief;

  @Column('uuid')
  briefId!: string;

  /**
   * Denormalised from the brief on purpose: the suppression lookup asks "has
   * this store dismissed this key lately", which spans briefs. Through the
   * parent it would be a join on every write.
   */
  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  @Column({ type: 'enum', enum: AdvisorInsightKind })
  kind!: AdvisorInsightKind;

  @Column({ type: 'enum', enum: AdvisorSeverity })
  severity!: AdvisorSeverity;

  /**
   * Derived from the **thing** the advice is about — `restock:<variantId>` —
   * and never from its wording, which the narrator rewrites every run.
   *
   * It is what makes a regeneration keep the status the owner set, what keeps
   * dismissed advice dismissed for a week, and what lets a later brief say "you
   * marked this acted nine days ago".
   */
  @Column({ type: 'varchar', length: INSIGHT_DEDUPE_KEY_MAX_LENGTH })
  dedupeKey!: string;

  @Column({ type: 'varchar', length: INSIGHT_TITLE_MAX_LENGTH })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  /**
   * The numbers, shaped per `kind`. `jsonb` rather than twelve nullable
   * columns because the fields differ per kind and nothing queries them.
   *
   * What it always carries: money in **minor units**, ids that link somewhere,
   * and never a formatted string.
   */
  @Column({ type: 'jsonb', default: {} })
  payload!: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: AdvisorInsightStatus,
    default: AdvisorInsightStatus.New,
  })
  status!: AdvisorInsightStatus;

  @Column({ type: 'timestamp', nullable: true })
  statusChangedAt!: Date | null;

  /**
   * The rank the writer assigned. Every insight of a brief is written in one
   * statement, so `createdAt` is identical across them and cannot order the
   * list — the same reason `OrderItem` carries one.
   */
  @Column({ type: 'int', default: 0 })
  position!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
