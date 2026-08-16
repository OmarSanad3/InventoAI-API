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
import { BRIEF_HEADLINE_MAX_LENGTH } from '../advisor.constants';
import { AdvisorGenerator } from '../enums/advisor-generator.enum';
import { NarratorStatus } from '../enums/narrator-status.enum';
import { AdvisorInsight } from './advisor-insight.entity';

/**
 * One morning's advice for one store.
 *
 * It is **written**, not computed on read, for three reasons any one of which
 * would be enough: a dashboard page load must not carry a Gemini call and eight
 * aggregate queries; a brief is a record of what the owner was told, and
 * re-deriving it tomorrow would silently rewrite yesterday's advice; and the
 * emailed brief and the rendered brief have to be the same brief.
 *
 * `UQ_advisor_briefs_store_date` is what makes the hourly scheduler safe. A
 * duplicate attempt loses to the index rather than to a lock held across a
 * model call — which is the difference between a race that cannot happen and a
 * race that usually does not.
 */
@Entity('advisor_briefs')
@Index('UQ_advisor_briefs_store_date', ['storeId', 'briefDate'], {
  unique: true,
})
@Index('IDX_advisor_briefs_store_created', ['storeId', 'createdAt'])
export class AdvisorBrief {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  /**
   * The store's **local** calendar day as `YYYY-MM-DD`. A `date` column rather
   * than a timestamp: "one brief per day" is a question about a calendar, and a
   * shop in Cairo must not have its day cut at 02:00 by a UTC boundary.
   */
  @Column({ type: 'date' })
  briefDate!: string;

  /** The one-sentence summary, and the email's subject line. */
  @Column({ type: 'varchar', length: BRIEF_HEADLINE_MAX_LENGTH })
  headline!: string;

  /** Denormalised for the list view; the insight rows are the truth. */
  @Column({ type: 'int', default: 0 })
  insightCount!: number;

  @Column({
    type: 'enum',
    enum: AdvisorGenerator,
    default: AdvisorGenerator.Schedule,
  })
  generatedBy!: AdvisorGenerator;

  /**
   * Whether Gemini wrote the prose or `buildFallbackSentence` did. A column
   * rather than an inference, because "why does today's brief read like a
   * robot" is a support question and the answer should not be a log grep.
   */
  @Column({
    type: 'enum',
    enum: NarratorStatus,
    default: NarratorStatus.Fallback,
  })
  narratorStatus!: NarratorStatus;

  @Column({ type: 'timestamp', nullable: true })
  emailedAt!: Date | null;

  @OneToMany(() => AdvisorInsight, (insight) => insight.brief)
  insights!: AdvisorInsight[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
