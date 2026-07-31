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
import { UserRole } from '../enums/user-role.enum';

// Postgres treats NULLs as distinct, so a single unique index over
// (email, storeId) would let two platform accounts share an address. Splitting
// the rule in two keeps NULL out of every comparison.
@Index('UQ_users_email_platform', ['email'], {
  unique: true,
  where: '"storeId" IS NULL',
})
@Index('UQ_users_email_store', ['email', 'storeId'], {
  unique: true,
  where: '"storeId" IS NOT NULL',
})
@Entity('users')
export class User {
  @PrimaryColumn('uuid')
  id!: string;

  @Column()
  firstName!: string;

  @Column()
  lastName!: string;

  @Column({ type: 'varchar', nullable: true })
  image!: string | null;

  @Column()
  email!: string;

  /**
   * The store this account belongs to. `null` for OWNER accounts, which are
   * platform-level — their store is reached through `Store.ownerId`.
   */
  @ManyToOne(() => Store, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store | null;

  @Column({ type: 'uuid', nullable: true })
  storeId!: string | null;

  @Column({ select: false })
  password!: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role!: UserRole;

  @Column({ default: false })
  isEmailVerified!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
