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
import { AuthProvider } from '../enums/auth-provider.enum';
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
// One Google identity is one platform account and one account per store it
// shops at — the same rule as the email indexes above, and split for the same
// reason. `googleId IS NOT NULL` keeps the rows that never linked out of it.
@Index('UQ_users_google_platform', ['googleId'], {
  unique: true,
  where: '"googleId" IS NOT NULL AND "storeId" IS NULL',
})
@Index('UQ_users_google_store', ['googleId', 'storeId'], {
  unique: true,
  where: '"googleId" IS NOT NULL AND "storeId" IS NOT NULL',
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

  /**
   * `null` for an account created by Google Sign-In that has never set one.
   * Every reader must cope: a null reaching `bcrypt.compare` is a 500 where the
   * caller deserves the ordinary bad-credentials 401.
   */
  @Column({ type: 'varchar', select: false, nullable: true })
  password!: string | null;

  /**
   * Google's `sub` — stable and immutable, which an email address is not. This
   * is what a returning Google user is found by; the address is only ever a
   * hint used for the first link.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  googleId!: string | null;

  @Column({
    type: 'enum',
    enum: AuthProvider,
    default: AuthProvider.Local,
  })
  authProvider!: AuthProvider;

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
