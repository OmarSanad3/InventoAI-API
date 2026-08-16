/**
 * Everything the Advisor decides with, in one place.
 *
 * These are **policy**, not deployment detail, which is why they are constants
 * rather than environment variables — the same call `CHAT_RETENTION_DAYS` made.
 * Changing what counts as "trending" changes what an owner is told to do with
 * their money, and that belongs in a code review.
 */

/* ── Windows ──────────────────────────────────────────────────────────────── */

/** The window "how is it selling right now" is measured over. */
export const VELOCITY_RECENT_DAYS = 7;

/** The 28 days before the recent window — what "right now" is compared to. */
export const VELOCITY_BASELINE_DAYS = 28;

/** How long a reorder should cover once it has arrived. */
export const RESTOCK_COVERAGE_DAYS = 14;

/* ── Restock ──────────────────────────────────────────────────────────────── */

/**
 * The stand-in until `Supplier` exists. A store-wide guess is honest; a
 * per-product one pretending to know the supplier is not.
 */
export const DEFAULT_SUPPLIER_LEAD_TIME_DAYS = 10;
export const MAX_LEAD_TIME_DAYS = 120;

/* ── Trending and its mirror ──────────────────────────────────────────────── */

/** Recent rate must be at least this multiple of the baseline rate. */
export const TRENDING_RATIO = 2;

/**
 * …and the recent window must have sold at least this many units. Without the
 * floor, "1 unit last month, 3 this month" is a 3× trend, which is noise wearing
 * a percentage.
 */
export const TRENDING_MIN_UNITS = 5;

/** Days without a single sale before stock counts as sitting still. */
export const SLOW_MOVER_DAYS = 45;

/** …and the tied-up cash must be worth a sentence. Minor units: 100.00. */
export const SLOW_MOVER_MIN_VALUE = 10_000;

/* ── The other collectors ─────────────────────────────────────────────────── */

/** Below this an unanswered theme is a coincidence, not demand. */
export const DEMAND_GAP_MIN_OCCURRENCES = 3;

export const CALENDAR_LOOKAHEAD_DAYS = 28;
export const WEATHER_LOOKAHEAD_DAYS = 7;
export const WEATHER_TIMEOUT_MS = 4_000;

/** Calibrated for Egypt and MENA, which is the target region. */
export const HEATWAVE_TEMP_C = 38;
export const COLD_SNAP_TEMP_C = 8;

/** Millimetres of rain in a day that are worth telling a shop about. */
export const HEAVY_RAIN_MM = 10;

/* ── The brief ────────────────────────────────────────────────────────────── */

/** A brief listing forty things is a spreadsheet, and an owner reads neither. */
export const MAX_INSIGHTS_PER_BRIEF = 8;

/**
 * How long a dismissed insight stays out of the brief. The signal is still
 * there — the stock is still low — and the owner has already said "I know".
 */
export const INSIGHT_SUPPRESSION_DAYS = 7;

/** Defined for the retention job that does not exist yet. */
export const BRIEF_RETENTION_DAYS = 365;

export const BRIEF_HEADLINE_MAX_LENGTH = 300;
export const INSIGHT_TITLE_MAX_LENGTH = 200;
export const INSIGHT_DEDUPE_KEY_MAX_LENGTH = 120;

/* ── Settings bounds ──────────────────────────────────────────────────────── */

export const ADVISOR_DEFAULT_SEND_HOUR = 7;
export const MIN_SEND_HOUR = 0;
export const MAX_SEND_HOUR = 23;
export const ADVISOR_TIMEZONE_MAX_LENGTH = 64;
export const ADVISOR_CITY_MAX_LENGTH = 120;
export const MIN_LATITUDE = -90;
export const MAX_LATITUDE = 90;
export const MIN_LONGITUDE = -180;
export const MAX_LONGITUDE = 180;

/* ── Machinery ────────────────────────────────────────────────────────────── */

/** The "run it now" button costs a Gemini call, so it gets a cooldown. */
export const ADVISOR_GENERATE_COOLDOWN_SECONDS = 300;
export const ADVISOR_GENERATE_COOLDOWN_KEY_PREFIX = 'advisor:generate:';

export const ADVISOR_LOCK_KEY = 'advisor:schedule:lock';
export const ADVISOR_LOCK_TTL_SECONDS = 600;

/**
 * `GeminiService` defaults to 0.9, which is tuned for inventing distinct
 * *themes*. A brief wants the boring answer — the same call the catalog
 * generation and the chatbot both made.
 */
export const NARRATOR_TEMPERATURE = 0.4;

/**
 * Untrusted text — a product title, a shopper's own question — is truncated to
 * this before it reaches the narrator's prompt. The model has no authority to
 * abuse, but a 40 KB "title" is still a bill.
 */
export const NARRATOR_INPUT_TEXT_MAX_LENGTH = 200;
