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
} from 'typeorm';
import { ChatResolution } from '../enums/chat-resolution.enum';
import { ChatRole } from '../enums/chat-role.enum';
import { ChatSession } from './chat-session.entity';

/** What an answer was built from. Ids only — the payload is fetched live. */
export interface ChatMessageSources {
  readonly productIds: string[];
  readonly faqIds: string[];
  readonly orderId: string | null;
}

/**
 * One turn of a conversation, user or assistant.
 *
 * Tool *arguments* are deliberately not stored: they are the model's paraphrase
 * of the user's own message, which is already the row above.
 */
@Entity('chat_messages')
@Index('IDX_chat_messages_session_created', ['sessionId', 'createdAt'])
@Index('IDX_chat_messages_store_resolution', ['storeId', 'resolution'])
export class ChatMessage {
  @PrimaryColumn('uuid')
  id!: string;

  @ManyToOne(() => ChatSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: ChatSession;

  @Column('uuid')
  sessionId!: string;

  /**
   * Denormalised from the session so the owner's dashboard and the unanswered
   * feed never need the join. The session's store is immutable, so the two
   * cannot drift.
   */
  @Column('uuid')
  storeId!: string;

  @Column({ type: 'enum', enum: ChatRole })
  role!: ChatRole;

  @Column('text')
  text!: string;

  /** Assistant messages only. See `ChatResolution` for why it is computed. */
  @Column({ type: 'enum', enum: ChatResolution, nullable: true })
  resolution!: ChatResolution | null;

  @Column({ type: 'jsonb', nullable: true })
  sources!: ChatMessageSources | null;

  @Column({ type: 'int', nullable: true })
  latencyMs!: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
