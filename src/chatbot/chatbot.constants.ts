export const CHATBOT_MESSAGE_MIN_LENGTH = 1;
export const CHATBOT_MESSAGE_MAX_LENGTH = 1000;

/**
 * How many times the model may call tools before the turn is cut short. Four is
 * enough for "search, then look one up, then check its stock"; a loop that wants
 * more is a loop.
 */
export const MAX_TOOL_ITERATIONS = 4;

/** A chat bubble is not a listing page — "here are four, see all →" reads better. */
export const CHATBOT_PRODUCT_CARD_LIMIT = 4;
export const CHATBOT_FAQ_CITATION_LIMIT = 2;

/** How many products a single `search_products` call may hand the model. */
export const CHATBOT_TOOL_RESULT_LIMIT = 6;

/** Recent orders `list_my_orders` returns without being asked for more. */
export const CHATBOT_ORDER_LIST_LIMIT = 5;

/**
 * `GeminiService` defaults to 0.9, which is tuned for inventing distinct
 * *themes*. An assistant quoting a return policy wants the boring answer, the
 * same call [catalog-ai-setup] made when it dropped to 0.7.
 */
export const CHATBOT_TEMPERATURE = 0.3;

export const CHATBOT_FALLBACK_MESSAGE =
  "Sorry, I couldn't get that right now — please try again in a moment.";

/**
 * The deterministic answer to an order question from a session with nobody
 * signed in. Not the model's improvisation: there is no tool for it to call, so
 * there is nothing for it to be creative with.
 */
export const CHATBOT_LOGIN_REQUIRED_MESSAGE =
  'Sign in to your account and I can pull up your order status right away.';

/** Past the per-session cap the shopper gets a sentence, not a 4xx. */
export const CHATBOT_SESSION_FULL_MESSAGE =
  "We've covered a lot in this chat — start a fresh one and I'll keep helping.";

/** `chat:rate:<sessionId>` — the per-session token bucket. */
export const CHAT_RATE_LIMIT_KEY_PREFIX = 'chat:rate';
export const CHAT_RATE_LIMIT_WINDOW_SECONDS = 60;

/* ── The owner's insights and settings ─────────────────────────────────── */

export const CHATBOT_GREETING_MAX_LENGTH = 300;

/** The RFC-max local+domain length, same bound `User.email` uses. */
export const CHATBOT_CONTACT_EMAIL_MAX_LENGTH = 320;

/** The default window for the unanswered feed and for `/chat/stats`. */
export const UNANSWERED_WINDOW_DAYS = 30;
export const UNANSWERED_STATS_MAX_DAYS = 365;

/**
 * Groups returned per window. An owner does not read past the top twenty and
 * the Advisor reads ten, so anything past this is weight without a reader.
 */
export const UNANSWERED_MAX_GROUPS = 200;

/**
 * Question rows read before grouping. The cap is on the input as well as the
 * output because grouping happens in Node: 200 groups can only ever come out of
 * the rows that went in, and a store with a year of traffic must not stream all
 * of it through a `map`.
 */
export const UNANSWERED_MAX_ROWS = 2000;

/**
 * Cosine **distance** below which two deterministic groups are the same theme.
 * `0.25` is a similarity of `0.75`, which sits above every off-topic pair
 * `KNOWLEDGE_MIN_SCORE` was measured against and below the "earbuds"/"airpods"
 * kind of match this pass exists to merge.
 */
export const UNANSWERED_CLUSTER_THRESHOLD = 0.25;

/** How many themes `listUnansweredThemes` hands the Daily AI Advisor. */
export const ADVISOR_THEME_LIMIT = 10;

/**
 * A session with no activity for this long is deleted with its messages.
 *
 * A constant rather than an env var on purpose: a transcript holds whatever a
 * shopper typed, which occasionally includes a phone number they should not
 * have typed. How long that is kept is a policy, and a policy changes with a
 * code review rather than with a deployment's `.env`.
 */
export const CHAT_RETENTION_DAYS = 180;

/** Products named in `/chat/stats`, hydrated to titles by the controller. */
export const CHAT_STATS_TOP_PRODUCTS = 10;

/** The nightly clustering + retention pass, guarded like the knowledge sweep. */
export const CHAT_MAINTENANCE_LOCK_KEY = 'chat:maintenance:lock';
export const CHAT_MAINTENANCE_LOCK_TTL_SECONDS = 600;

/** The first bubble when an owner has not written one. */
export function buildDefaultGreeting(storeName: string): string {
  return `Hi! I'm ${storeName}'s assistant — ask me about our products, an order or our policies.`;
}
