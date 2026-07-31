import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { SiteBuildStep } from '../enums/site-build-step.enum';
import { QuestionAnswer } from '../types/question-answer';

/**
 * Everything the owner produced before publishing, one row per owner. Kept in
 * Postgres rather than Redis because the flow spans sessions — losing a
 * brainstorm to a TTL is not acceptable.
 */
@Entity('site_build_drafts')
export class SiteBuildDraft {
  @PrimaryColumn('uuid')
  id!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  owner!: User;

  @Column('uuid')
  ownerId!: string;

  @Column('text')
  brainstorm!: string;

  @Column({ type: 'varchar', nullable: true })
  logoUrl!: string | null;

  @Column({ type: 'varchar', nullable: true })
  logoPublicId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  answers!: QuestionAnswer[] | null;

  @Column({ type: 'varchar', nullable: true })
  businessName!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', nullable: true })
  heroHeadline!: string | null;

  @Column({ type: 'varchar', nullable: true })
  heroSubtitle!: string | null;

  @Column({ type: 'varchar', nullable: true })
  slug!: string | null;

  @Column({ type: 'enum', enum: SiteBuildStep })
  step!: SiteBuildStep;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
