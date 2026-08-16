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
  CHATBOT_CONTACT_EMAIL_MAX_LENGTH,
  CHATBOT_GREETING_MAX_LENGTH,
} from '../chatbot.constants';
import { ChatbotTone } from '../enums/chatbot-tone.enum';

/**
 * One store's switches for its assistant, created lazily on first read.
 *
 * A table of its own rather than four more columns on `Store`: `Store` is the
 * site-builder's entity and already carries the branding, the slug, the currency
 * and the order numbering. A store that never opens the chatbot page never gets
 * a row, and a missing row reads as the defaults below.
 */
@Entity('chatbot_settings')
@Index('IDX_chatbot_settings_store', ['storeId'], { unique: true })
export class ChatbotSettings {
  @PrimaryColumn('uuid')
  id!: string;

  @OneToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store!: Store;

  @Column('uuid')
  storeId!: string;

  /** False hides the widget and makes `POST /site/:slug/chat` a 404. */
  @Column({ type: 'boolean', default: true })
  isEnabled!: boolean;

  /** The first bubble. Null falls back to a default in the store's own name. */
  @Column({
    type: 'varchar',
    length: CHATBOT_GREETING_MAX_LENGTH,
    nullable: true,
  })
  greeting!: string | null;

  @Column({ type: 'enum', enum: ChatbotTone, default: ChatbotTone.Friendly })
  tone!: ChatbotTone;

  /** Offered by the assistant when it has nothing to answer with. */
  @Column({
    type: 'varchar',
    length: CHATBOT_CONTACT_EMAIL_MAX_LENGTH,
    nullable: true,
  })
  contactEmail!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @BeforeInsert()
  generateId(): void {
    this.id = randomUUID();
  }
}
