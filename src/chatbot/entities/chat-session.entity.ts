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
import { User } from '../../users/entities/user.entity';

/**
 * One conversation with one store's assistant.
 *
 * The id is server-issued and the client echoes it back, so it is a
 * **capability**: whoever holds it can read the transcript. That is fine while
 * the conversation is a stranger asking about mugs, and not fine once the
 * assistant has read an order's contact details back — which is why the
 * transcript route requires the owning user's token as soon as `userId` is set.
 *
 * `userId` is `SET NULL`, not `CASCADE`: deleting an account must not delete the
 * store's record of what it was asked, the same call `Order` made.
 */
@Entity('chat_sessions')
@Index('IDX_chat_sessions_store_last', ['storeId', 'lastMessageAt'])
export class ChatSession {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  /** Bound the first time a request arrives with a token, and never unbound. */
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  /** Enforces the per-session cap without a count query on every message. */
  @Column({ type: 'int', default: 0 })
  messageCount!: number;

  @Column({ type: 'timestamp', nullable: true })
  lastMessageAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
