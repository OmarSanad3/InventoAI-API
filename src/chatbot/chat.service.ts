import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { EnvironmentVariables } from '../config/env.validation';
import { RedisService } from '../redis/redis.service';
import { Store } from '../site-builder/entities/store.entity';
import { StoreService } from '../site-builder/store.service';
import {
  CHAT_RATE_LIMIT_KEY_PREFIX,
  CHAT_RATE_LIMIT_WINDOW_SECONDS,
  CHATBOT_FALLBACK_MESSAGE,
  CHATBOT_LOGIN_REQUIRED_MESSAGE,
  CHATBOT_SESSION_FULL_MESSAGE,
} from './chatbot.constants';
import { ChatFinalizer } from './chat-finalizer.service';
import { ChatbotSettingsService } from './chatbot-settings.service';
import { ChatbotSettings } from './entities/chatbot-settings.entity';
import { ChatReplyDto } from './dto/chat-reply.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatSession } from './entities/chat-session.entity';
import { ChatResolution } from './enums/chat-resolution.enum';
import { ChatRole } from './enums/chat-role.enum';
import { ChatAgentFactory } from './graph/chat-agent.factory';
import { ChatTurnContext, createTurnSources } from './types/chat-turn';

/**
 * One turn, end to end: the guardrails, the session, the model, and the row that
 * records what happened.
 *
 * The order of the guardrails is the cheapest rejection first, and the user's
 * message is persisted **before** the model runs — a turn that times out should
 * still leave the question in the transcript, and an unanswered question that
 * crashed the agent is exactly the kind an owner most wants to see.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepository: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepository: Repository<ChatMessage>,
    private readonly storeService: StoreService,
    private readonly settingsService: ChatbotSettingsService,
    private readonly agentFactory: ChatAgentFactory,
    private readonly finalizer: ChatFinalizer,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  async sendMessage(
    slug: string,
    dto: SendMessageDto,
    user: JwtPayload | null,
    store: Store,
    callerKey: string,
  ): Promise<ChatReplyDto> {
    const settings = await this.assertAssistantIsEnabled(store);
    await this.enforceRateLimit(store.id, callerKey);
    const session = await this.resolveSession(store, dto.sessionId, user);

    const userMessage = await this.recordMessage(session, {
      role: ChatRole.User,
      text: dto.message,
    });

    if (this.isSessionFull(session)) {
      return this.replyDeterministically(
        session,
        CHATBOT_SESSION_FULL_MESSAGE,
        ChatResolution.Error,
      );
    }

    const context: ChatTurnContext = { store, slug, user, settings };
    const sources = createTurnSources();
    const startedAt = Date.now();

    let text = '';
    let hasFailed = false;
    try {
      const history = await this.buildHistory(session, userMessage);
      const result = await this.agentFactory.run(context, history, sources);
      text = result.text;
      hasFailed = result.exhaustedToolBudget || text.length === 0;
    } catch (err) {
      // A model that misbehaved is not a 500 for the shopper. The exception is
      // logged with the session id and the turn is recorded as an error.
      this.logger.error(
        `Chat turn failed for session ${session.id}: ${String(err)}`,
      );
      hasFailed = true;
    }

    const finalized = await this.finalizer.finalize(context, sources, {
      hasFailed,
    });

    // The one place the model does not get the last word on wording: an order
    // question with nobody signed in gets a fixed sentence and a login link.
    if (finalized.resolution === ChatResolution.NeedsLogin) {
      text = CHATBOT_LOGIN_REQUIRED_MESSAGE;
    } else if (hasFailed) {
      text = CHATBOT_FALLBACK_MESSAGE;
    }

    const assistantMessage = await this.recordMessage(session, {
      role: ChatRole.Assistant,
      text,
      resolution: finalized.resolution,
      sources: {
        productIds: sources.productIds,
        faqIds: sources.faqIds,
        orderId: sources.orderId,
      },
      latencyMs: Date.now() - startedAt,
      // The link the owner's unanswered feed reads back: the resolution lives
      // here, on the answer, and the question an owner needs to see is the row
      // above it.
      questionId: userMessage.id,
    });

    return {
      sessionId: session.id,
      message: {
        id: assistantMessage.id,
        text: assistantMessage.text,
        createdAt: assistantMessage.createdAt,
      },
      resolution: finalized.resolution,
      products: finalized.products,
      faqs: finalized.faqs,
      order: finalized.order,
      requiresLogin: finalized.resolution === ChatResolution.NeedsLogin,
    };
  }

  /** The transcript, oldest first. Authorisation is the caller's job. */
  async getTranscript(
    store: Store,
    sessionId: string,
  ): Promise<{ session: ChatSession; messages: ChatMessage[] }> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId, storeId: store.id },
    });
    if (!session) {
      throw new NotFoundException('Conversation not found');
    }

    const messages = await this.messageRepository.find({
      where: { sessionId: session.id },
      order: { createdAt: 'ASC' },
    });
    return { session, messages };
  }

  async resolvePublicStore(slug: string): Promise<Store> {
    const { store } = await this.storeService.resolvePublicStore(slug);
    return store;
  }

  /** What the storefront widget reads before it decides to render at all. */
  async getPublicSettings(store: Store): Promise<ChatbotSettings> {
    return this.settingsService.resolveForStore(store);
  }

  /**
   * An assistant its owner switched off is a route that does not exist.
   *
   * A 404 rather than a 403, and before the session is resolved: a disabled
   * store must not be told apart from a store that never had a chatbot, and a
   * message sent to one must not leave a conversation row behind.
   */
  private async assertAssistantIsEnabled(
    store: Store,
  ): Promise<ChatbotSettings> {
    const settings = await this.settingsService.resolveForStore(store);
    if (!settings.isEnabled) {
      // Worded exactly as Nest words an unmatched route, so "switched off" and
      // "never existed" are not distinguishable from the outside.
      throw new NotFoundException(`Cannot POST /site/${store.slug}/chat`);
    }
    return settings;
  }

  /**
   * An unknown or foreign `sessionId` is a 404 rather than a fresh session: a
   * client that quietly lost its conversation would never find out.
   *
   * A session is bound to a user the first time a request arrives with a token,
   * and never unbound.
   */
  private async resolveSession(
    store: Store,
    sessionId: string | undefined,
    user: JwtPayload | null,
  ): Promise<ChatSession> {
    if (!sessionId) {
      return this.sessionRepository.save(
        this.sessionRepository.create({
          storeId: store.id,
          userId: user?.sub ?? null,
        }),
      );
    }

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId, storeId: store.id },
    });
    if (!session) {
      throw new NotFoundException('Conversation not found');
    }

    if (user && !session.userId) {
      session.userId = user.sub;
      await this.sessionRepository.save(session);
    }
    return session;
  }

  /**
   * Keyed on the **caller**, not on the session.
   *
   * Keying it on `sessionId` was the first attempt and it does nothing: the
   * session id comes from the client, so omitting it opens a fresh session — and
   * a fresh counter — on every request. The caller is the signed-in user when
   * there is one and the request's IP when there is not, which is the thing
   * abuse actually has to come from.
   *
   * It runs before the session is resolved, so a flood cannot leave a trail of
   * empty sessions behind it either.
   */
  private async enforceRateLimit(
    storeId: string,
    callerKey: string,
  ): Promise<void> {
    const limit = this.configService.get('CHATBOT_RATE_LIMIT_PER_MINUTE', {
      infer: true,
    });
    const key = `${CHAT_RATE_LIMIT_KEY_PREFIX}:${storeId}:${callerKey}`;
    const used = await this.redisService.increment(
      key,
      CHAT_RATE_LIMIT_WINDOW_SECONDS,
    );

    if (used > limit) {
      const remaining = await this.redisService.ttl(key);
      throw new HttpException(
        `That is a lot of questions at once — please wait ${remaining} seconds`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private isSessionFull(session: ChatSession): boolean {
    const cap = this.configService.get('CHATBOT_MAX_MESSAGES_PER_SESSION', {
      infer: true,
    });
    return session.messageCount > cap;
  }

  /**
   * The last N turns, oldest first, plus the message being asked now.
   *
   * Loaded from `ChatMessage` rather than from a LangGraph checkpointer: a
   * `MemorySaver` dies with the process and is wrong the moment there are two
   * instances, and a `PostgresSaver` would add tables this project does not
   * control next to the ones it needs anyway for the owner's dashboard.
   */
  private async buildHistory(
    session: ChatSession,
    current: ChatMessage,
  ): Promise<BaseMessage[]> {
    const turns = this.configService.get('CHATBOT_HISTORY_TURNS', {
      infer: true,
    });

    const recent = await this.messageRepository.find({
      where: { sessionId: session.id },
      order: { createdAt: 'DESC' },
      // Two rows per turn, plus the one just recorded.
      take: turns * 2 + 1,
    });

    const history = recent
      .reverse()
      // Excluded by id, not by text: the question was recorded before the model
      // ran, and it is appended below as the turn being answered.
      .filter((row) => row.id !== current.id)
      .map((row) =>
        row.role === ChatRole.User
          ? new HumanMessage(row.text)
          : new AIMessage(row.text),
      );

    return [...history, new HumanMessage(current.text)];
  }

  private async recordMessage(
    session: ChatSession,
    fields: Partial<ChatMessage> & { role: ChatRole; text: string },
  ): Promise<ChatMessage> {
    const message = await this.messageRepository.save(
      this.messageRepository.create({
        sessionId: session.id,
        storeId: session.storeId,
        ...fields,
      }),
    );

    session.messageCount += 1;
    session.lastMessageAt = message.createdAt;
    await this.sessionRepository.save(session);

    return message;
  }

  /** A refusal the model never sees, for the cases it must not be asked about. */
  private async replyDeterministically(
    session: ChatSession,
    text: string,
    resolution: ChatResolution,
  ): Promise<ChatReplyDto> {
    const message = await this.recordMessage(session, {
      role: ChatRole.Assistant,
      text,
      resolution,
    });

    return {
      sessionId: session.id,
      message: {
        id: message.id,
        text: message.text,
        createdAt: message.createdAt,
      },
      resolution,
      products: [],
      faqs: [],
      order: null,
      requiresLogin: resolution === ChatResolution.NeedsLogin,
    };
  }
}
