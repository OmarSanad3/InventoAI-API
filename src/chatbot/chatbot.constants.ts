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
