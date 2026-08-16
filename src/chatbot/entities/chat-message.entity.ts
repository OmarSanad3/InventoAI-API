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

  /**
   * The user message this reply answered, on assistant rows only.
   *
   * The resolution lives here, on the answer — but the owner's unanswered feed
   * is a list of **questions**, and without this link finding the question
   * behind an `unanswered` row means a window function over the whole store's
   * transcript. One nullable uuid buys an indexed join instead.
   */
  @Column({ type: 'uuid', nullable: true })
  questionId!: string | null;

  /**
   * Set by the owner from the unanswered feed: they stocked the thing, or they
   * decided not to. A reviewed row leaves the default feed and stops reaching
   * the Advisor, which is what keeps a brief from repeating itself for a month.
   */
  @Column({ type: 'timestamp', nullable: true })
  reviewedAt!: Date | null;

  /**
   * The nightly semantic pass's grouping, and only ever an optimisation: the
   * feed groups deterministically first and merges on this when it is there, so
   * an unavailable embedding service costs a coarser grouping and not an error.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  clusterKey!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
