import { randomUUID } from 'node:crypto';
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { DEFAULT_CURRENCY } from '../site-builder.constants';
import { LogoSource } from '../enums/logo-source.enum';
import { StoreStatus } from '../enums/store-status.enum';
import { StoreTheme } from './store-theme.entity';

@Entity('stores')
export class Store {
  @PrimaryColumn('uuid')
  id!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  owner!: User;

  @Column('uuid')
  ownerId!: string;

  @Column()
  name!: string;

  @Column({ unique: true })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', nullable: true })
  logoUrl!: string | null;

  @Column({ type: 'varchar', nullable: true })
  logoPublicId!: string | null;

  @Column({ type: 'enum', enum: LogoSource, nullable: true })
  logoSource!: LogoSource | null;

  @Column({ type: 'varchar', nullable: true })
  heroImageUrl!: string | null;

  @Column({ type: 'varchar', nullable: true })
  heroImagePublicId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  heroHeadline!: string | null;

  @Column({ type: 'varchar', nullable: true })
  heroSubtitle!: string | null;

  @Column({ type: 'varchar', nullable: true })
  heroCtaLabel!: string | null;

  @Column({ type: 'varchar', nullable: true })
  heroCtaHref!: string | null;

  @Column({ type: 'enum', enum: StoreStatus, default: StoreStatus.Draft })
  status!: StoreStatus;

  @Column({ default: 'en' })
  locale!: string;

  /** ISO 4217 code every amount in this store's rows is denominated in. */
  @Column({ type: 'varchar', length: 3, default: DEFAULT_CURRENCY })
  currency!: string;

  /** Counter behind this store's human-readable order numbers. */
  @Column({ type: 'int', default: 1 })
  nextOrderNumber!: number;

  @OneToMany(() => StoreTheme, (theme) => theme.store)
  themes!: StoreTheme[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
