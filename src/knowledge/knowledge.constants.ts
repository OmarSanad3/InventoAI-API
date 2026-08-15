/**
 * Gemini's embedding input caps at 2048 tokens. Arabic tokenises denser than
 * English, so 4000 characters stays inside it in both languages with room to
 * spare — and it is above every text column that feeds a document.
 */
export const KNOWLEDGE_DOCUMENT_MAX_CHARS = 4000;

/**
 * Texts per `embedContent` call. The free tier is rate-limited per *request*,
 * not per text, so batching is the difference between one call and thirty-two.
 */
export const EMBED_BATCH_SIZE = 32;

/** Attempts inside one embedding call before it gives up. */
export const MAX_EMBED_ATTEMPTS = 3;

/** Milliseconds before the first retry; doubled each attempt. */
export const EMBED_RETRY_BASE_DELAY_MS = 500;

/**
 * A document that failed this many times stops being retried by the incremental
 * sweep and is reported by `GET /knowledge/status` instead. One malformed row
 * must not stall the queue behind it.
 */
export const MAX_INDEX_FAILURES = 3;

export const KNOWLEDGE_SWEEP_INTERVAL_SECONDS = 60;
export const KNOWLEDGE_SWEEP_BATCH = 64;

export const KNOWLEDGE_RETRIEVAL_LIMIT = 8;

/**
 * The floor under a **cosine similarity** before fusion. Without it every query
 * returns eight documents, because the nearest neighbour of "1 + 1" is still
 * *something* — and the chatbot's refusal path depends on telling "nothing
 * relevant" from "eight weak matches".
 *
 * `0.6` is measured against `gemini-embedding-001` on the seeded stores, not
 * guessed, and the gap is narrower than it looks — this model's embeddings are
 * never far apart:
 *
 * | Query | Best match |
 * | --- | --- |
 * | "something light to wear in the summer heat" | `0.741` Linen Summer Abaya |
 * | "can I return something I bought three weeks ago" | `0.664` the returns FAQ |
 * | "عباية سوداء للمناسبات" | `0.731` the Abayas category |
 * | "what is 1 + 1" | `0.552` |
 * | "my car will not start this morning" | `0.554` |
 * | "who won the world cup in 1998" | `0.468` |
 *
 * **It is calibrated to the model, so it moves when the model does.** Re-measure
 * before changing `GEMINI_EMBEDDING_MODEL`; a threshold carried over from a
 * different embedding space is either a refusal for everything or a refusal for
 * nothing.
 */
export const KNOWLEDGE_MIN_SCORE = 0.6;

/** The standard reciprocal-rank-fusion constant. Ranks only, never scores. */
export const RRF_K = 60;

export const KNOWLEDGE_REINDEX_COOLDOWN_SECONDS = 300;

export const SWEEP_LOCK_KEY = 'knowledge:sweep:lock';
export const SWEEP_LOCK_TTL_SECONDS = 120;

/** `reindex:<storeId>` — the cooldown behind the dashboard's rebuild button. */
export const REINDEX_COOLDOWN_KEY_PREFIX = 'knowledge:reindex';

/** The table `synchronize` must never learn about. */
export const KNOWLEDGE_EMBEDDINGS_TABLE = 'knowledge_embeddings';

/** The one dimension count the schema, the config and the provider must agree on. */
export const EMBEDDING_DIMENSIONS = 768;
