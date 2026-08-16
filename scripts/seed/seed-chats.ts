import { DataSource, EntityManager } from 'typeorm';
import { UNANSWERED_MAX_GROUPS } from '../../src/chatbot/chatbot.constants';
import { summarizeUnanswered } from '../../src/chatbot/utils/summarize-unanswered.util';
import { ChatMessage } from '../../src/chatbot/entities/chat-message.entity';
import { ChatSession } from '../../src/chatbot/entities/chat-session.entity';
import { ChatResolution } from '../../src/chatbot/enums/chat-resolution.enum';
import { ChatRole } from '../../src/chatbot/enums/chat-role.enum';
import { SeededFaq } from './seed-faqs';
import { SeededProduct } from './seed-catalog';
import { SeededStore } from './seed-stores';

/** One store's transcripts, so the report can print what the dashboard will show. */
export interface SeededChat {
  readonly storeSlug: string;
  readonly sessions: number;
  readonly unansweredThemes: number;
}

interface SeedTurn {
  readonly question: string;
  readonly answer: string;
  readonly resolution: ChatResolution;
  /** The product the assistant surfaced, by its seeded title. */
  readonly productTitle?: string;
  /** Cites the store's first published FAQ entry. */
  readonly citesFaq?: boolean;
}

interface SeedChatSession {
  readonly storeSlug: string;
  /** Null is an anonymous shopper, which most of them are. */
  readonly buyerEmail: string | null;
  /** How far back the conversation happened, so the list has an order. */
  readonly daysAgo: number;
  readonly turns: readonly SeedTurn[];
}

/**
 * Conversations for every live store, so the owner's dashboard renders
 * something before a single real shopper arrives.
 *
 * The three "leather handbag" sessions are the point of the fixture: they are
 * three shoppers, three phrasings and one demand signal, and
 * `GET /chat/unanswered` must show them as **one** group of three rather than
 * as three rows. Note that they all say "handbag" and not "handbags" — the
 * deterministic pass has no stemmer, which is a real property of the feed and
 * not something a fixture should hide.
 *
 * `draftco` gets none: a draft store 404s on the chat route, which is the case
 * that needs to stay reachable.
 */
const SEED_CHATS: readonly SeedChatSession[] = [
  {
    storeSlug: 'layali',
    buyerEmail: 'shopper.layali@inventoai.test',
    daysAgo: 1,
    turns: [
      {
        question: 'I need something light to wear in the summer heat',
        answer:
          'The Linen Summer Abaya is our lightest piece — breathable linen, cut loose for hot days.',
        resolution: ChatResolution.Answered,
        productTitle: 'Linen Summer Abaya',
      },
      {
        question: 'and can I return it if it does not fit?',
        answer:
          'Yes — our returns policy covers unworn items, and the details are in the FAQ below.',
        resolution: ChatResolution.Answered,
        citesFaq: true,
      },
    ],
  },
  {
    storeSlug: 'layali',
    buyerEmail: null,
    daysAgo: 2,
    turns: [
      {
        question: 'what is 1 + 1?',
        answer:
          "Hi! I'm the shop's assistant — I can help with our abayas, hijabs, an order or our policies.",
        resolution: ChatResolution.OffTopic,
      },
    ],
  },
  {
    storeSlug: 'layali',
    buyerEmail: null,
    daysAgo: 3,
    turns: [
      {
        question: 'do you have a leather handbag',
        answer:
          "I couldn't find anything like that in our catalog — we carry abayas, hijabs and accessories.",
        resolution: ChatResolution.Unanswered,
      },
    ],
  },
  {
    storeSlug: 'layali',
    buyerEmail: null,
    daysAgo: 4,
    turns: [
      {
        question: "I'm looking for a leather handbag",
        answer: "Sorry, we don't stock anything like that at the moment.",
        resolution: ChatResolution.Unanswered,
      },
    ],
  },
  {
    storeSlug: 'layali',
    buyerEmail: 'shopper.layali@inventoai.test',
    daysAgo: 5,
    turns: [
      {
        question: 'leather handbag?',
        answer: "That isn't something we sell — can I help with anything else?",
        resolution: ChatResolution.Unanswered,
      },
    ],
  },
  {
    storeSlug: 'fokhar',
    buyerEmail: 'shopper.fokhar@inventoai.test',
    daysAgo: 1,
    turns: [
      {
        question: 'something for morning coffee',
        answer:
          'The Fayoum Stoneware Mug is our everyday cup — fired in Fayoum, and it takes a full mug of coffee.',
        resolution: ChatResolution.Answered,
        productTitle: 'Fayoum Stoneware Mug',
      },
    ],
  },
  {
    storeSlug: 'fokhar',
    buyerEmail: null,
    daysAgo: 2,
    turns: [
      {
        question: 'do you have an espresso cup',
        answer: "We don't have espresso cups — our smallest piece is the mug.",
        resolution: ChatResolution.Unanswered,
      },
    ],
  },
  {
    storeSlug: 'fokhar',
    buyerEmail: null,
    daysAgo: 6,
    turns: [
      {
        question: 'espresso cup in stock?',
        answer: 'Sorry, no espresso cup — I can show you the mugs instead.',
        resolution: ChatResolution.Unanswered,
      },
    ],
  },
];

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const MILLISECONDS_PER_DAY = 24 * MILLISECONDS_PER_HOUR;

/** Seconds between the question and the reply, so a transcript reads in order. */
const REPLY_DELAY_SECONDS = 3;

/** Minutes between the turns of one conversation. */
const TURN_GAP_MINUTES = 2;

/**
 * Writes the transcripts straight through the repositories, like the rest of the
 * seed: `ChatService` needs a model, a store slug and a request, and none of the
 * three exist here.
 *
 * What it does **not** shortcut is the shape branch 3 reads: every assistant row
 * carries the `resolution` the live path would have computed and a `questionId`
 * pointing at the question it answered, because a seeded row the unanswered feed
 * cannot see is worse than no seed at all.
 */
export async function seedChats(
  dataSource: DataSource,
  stores: readonly SeededStore[],
  products: readonly SeededProduct[],
  faqs: readonly SeededFaq[],
): Promise<SeededChat[]> {
  const seeded: SeededChat[] = [];

  for (const { store, definition, accounts } of stores) {
    const fixtures = SEED_CHATS.filter(
      (fixture) => fixture.storeSlug === definition.slug,
    );
    if (fixtures.length === 0) {
      continue;
    }

    for (const fixture of fixtures) {
      const buyer = fixture.buyerEmail
        ? accounts.find((account) => account.user.email === fixture.buyerEmail)
        : null;
      if (fixture.buyerEmail && !buyer) {
        throw new Error(`seed: no account ${fixture.buyerEmail}`);
      }

      await dataSource.transaction((manager) =>
        writeSession({
          manager,
          storeId: store.id,
          userId: buyer?.user.id ?? null,
          fixture,
          products: products.filter(
            (entry) => entry.storeSlug === definition.slug,
          ),
          faqs: faqs.filter((entry) => entry.storeSlug === definition.slug),
        }),
      );
    }

    seeded.push({
      storeSlug: definition.slug,
      sessions: fixtures.length,
      unansweredThemes: countThemes(fixtures),
    });
  }

  return seeded;
}

async function writeSession({
  manager,
  storeId,
  userId,
  fixture,
  products,
  faqs,
}: {
  manager: EntityManager;
  storeId: string;
  userId: string | null;
  fixture: SeedChatSession;
  products: readonly SeededProduct[];
  faqs: readonly SeededFaq[];
}): Promise<void> {
  // An hour inside the day rather than exactly on it: a conversation seeded at
  // exactly `now - 2 days` falls *outside* a `?days=2` window the moment the
  // seed is a minute old, which makes the window filters look broken when they
  // are working.
  const startedAt = new Date(
    Date.now() - fixture.daysAgo * MILLISECONDS_PER_DAY + MILLISECONDS_PER_HOUR,
  );

  const session = await manager.save(
    manager.create(ChatSession, {
      storeId,
      userId,
      messageCount: fixture.turns.length * 2,
      lastMessageAt: startedAt,
    }),
  );

  let lastAt = startedAt;

  for (const [index, turn] of fixture.turns.entries()) {
    const askedAt = addMinutes(startedAt, index * TURN_GAP_MINUTES);
    const answeredAt = addSeconds(askedAt, REPLY_DELAY_SECONDS);

    const question = await manager.save(
      manager.create(ChatMessage, {
        sessionId: session.id,
        storeId,
        role: ChatRole.User,
        text: turn.question,
      }),
    );
    const answer = await manager.save(
      manager.create(ChatMessage, {
        sessionId: session.id,
        storeId,
        role: ChatRole.Assistant,
        text: turn.answer,
        resolution: turn.resolution,
        questionId: question.id,
        latencyMs: REPLY_DELAY_SECONDS * 1000,
        sources: {
          productIds: resolveProductIds(turn, products),
          faqIds: resolveFaqIds(turn, faqs),
          orderId: null,
        },
      }),
    );

    // `@CreateDateColumn` is written by the ORM on insert, so backdating is a
    // second statement rather than a field. Worth the statement: without it
    // every seeded conversation lands on the same second and the dashboard's
    // "newest activity first" has nothing to sort by.
    await backdate(manager, question.id, askedAt);
    await backdate(manager, answer.id, answeredAt);
    lastAt = answeredAt;
  }

  await manager.update(ChatSession, session.id, { lastMessageAt: lastAt });
  await manager.query(
    `UPDATE chat_sessions SET "createdAt" = $2 WHERE id = $1`,
    [session.id, startedAt],
  );
}

async function backdate(
  manager: EntityManager,
  messageId: string,
  at: Date,
): Promise<void> {
  await manager.query(
    `UPDATE chat_messages SET "createdAt" = $2 WHERE id = $1`,
    [messageId, at],
  );
}

function resolveProductIds(
  turn: SeedTurn,
  products: readonly SeededProduct[],
): string[] {
  if (!turn.productTitle) {
    return [];
  }
  const match = products.find(
    (entry) => entry.product.title === turn.productTitle,
  );
  if (!match) {
    throw new Error(`seed: no product titled "${turn.productTitle}"`);
  }
  return [match.product.id];
}

function resolveFaqIds(turn: SeedTurn, faqs: readonly SeededFaq[]): string[] {
  if (!turn.citesFaq) {
    return [];
  }
  const match = faqs.find((entry) => entry.faq.isPublished);
  return match ? [match.faq.id] : [];
}

/**
 * What `GET /chat/unanswered` should report, computed with the same helper the
 * endpoint uses — a seed that printed its own arithmetic could disagree with
 * the feed it is meant to demonstrate.
 */
function countThemes(fixtures: readonly SeedChatSession[]): number {
  const questions = fixtures
    .flatMap((fixture) => fixture.turns)
    .filter((turn) => turn.resolution === ChatResolution.Unanswered)
    .map((turn, index) => ({
      id: String(index),
      question: turn.question,
      askedAt: new Date(0),
      clusterKey: null,
      isReviewed: false,
    }));

  return summarizeUnanswered(questions, { maxGroups: UNANSWERED_MAX_GROUPS })
    .length;
}

function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * 60 * 1000);
}

function addSeconds(at: Date, seconds: number): Date {
  return new Date(at.getTime() + seconds * 1000);
}
