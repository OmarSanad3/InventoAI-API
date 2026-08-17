import { PurchaseRequestStatus } from './enums/purchase-request-status.enum';

/** A store's supplier book is a page of contacts, not a directory. */
export const MAX_SUPPLIERS_PER_STORE = 100;

/** One request, several suppliers — but a mail-out, not a mail-shot. */
export const MAX_RECIPIENTS_PER_REQUEST = 10;

/**
 * A supplier who delivers in no days at all is a shelf, not a supplier. The
 * Advisor's store-wide setting allows `0` because "I have no lead time to speak
 * of" is a legitimate thing to say about a whole store; a named supplier's own
 * estimate is not.
 */
export const MIN_LEAD_TIME_DAYS = 1;

export const SUPPLIER_NAME_MIN_LENGTH = 2;
export const SUPPLIER_NAME_MAX_LENGTH = 120;
export const SUPPLIER_EMAIL_MAX_LENGTH = 255;
export const SUPPLIER_PHONE_MAX_LENGTH = 30;
export const SUPPLIER_NOTES_MAX_LENGTH = 1000;

export const REQUEST_SUBJECT_MIN_LENGTH = 5;
export const REQUEST_SUBJECT_MAX_LENGTH = 200;
export const REQUEST_BODY_MIN_LENGTH = 20;
export const REQUEST_BODY_MAX_LENGTH = 4000;
export const REQUEST_NOTE_MAX_LENGTH = 500;

export const MAX_REQUEST_QUANTITY = 100_000;
export const MAX_OFFER_DELIVERY_DAYS = 365;
export const MAX_NEEDED_WITHIN_DAYS = 365;
export const OFFER_NOTES_MAX_LENGTH = 500;

/** A pasted email body. Long enough for a quotation with its thread quoted. */
export const MAX_REPLY_LENGTH = 10_000;

/**
 * A draft wants the boring answer — the same call
 * `CATALOG_GENERATION_TEMPERATURE` makes.
 */
export const REQUEST_DRAFT_TEMPERATURE = 0.6;

/**
 * Extraction wants the same number twice from the same text. This is reading,
 * not writing, and there is nothing to be creative about.
 */
export const OFFER_EXTRACTION_TEMPERATURE = 0.1;

/**
 * The largest unit price the model is allowed to have read, in **major** units.
 * Anything above it is a misread — a phone number, an order reference, a total
 * mistaken for a unit price — and is dropped rather than stored.
 */
export const MAX_OFFER_UNIT_PRICE = 1_000_000;

/** Minor units per major unit. Every amount in this codebase is an int of these. */
export const MINOR_UNITS_PER_MAJOR = 100;

/**
 * The OAuth `state` lives in Redis for as long as a consent screen can
 * reasonably take. Long enough for an owner to read Google's warning about an
 * unverified app; short enough that a leaked callback URL is worthless by the
 * time anybody finds it.
 */
export const MAILBOX_STATE_TTL_SECONDS = 600;

/**
 * `mailbox:state:<storeId>` → the `state` that store's in-flight consent is
 * carrying. Keyed by store rather than by state so one store has one flow open
 * at a time, and so the callback compares a value it looked up by a key the
 * caller does not control.
 */
export const MAILBOX_STATE_KEY_PREFIX = 'mailbox:state:';

export const MAILBOX_SYNC_LOCK_KEY = 'suppliers:mailbox-sync';
export const MAILBOX_SYNC_LOCK_TTL_SECONDS = 300;

/**
 * A mailbox call that hangs must not hold the sync lock for its whole TTL. The
 * same reasoning as `WEATHER_TIMEOUT_MS`, with a longer bound because this one
 * fetches message bodies rather than a small JSON forecast.
 */
export const MAILBOX_API_TIMEOUT_MS = 10_000;

/**
 * How much backlog one pass will walk. A mailbox that has moved a great deal
 * since the last sync is read across several passes rather than in one long
 * one — the watermark only advances over pages actually processed, so nothing
 * is skipped by stopping early.
 */
export const MAILBOX_MAX_HISTORY_PAGES = 10;

/** Replies read in a single pass, per store. A cap on Gemini calls as much as
 *  on HTTP ones: each reply costs an extraction. */
export const MAILBOX_MAX_REPLIES_PER_SYNC = 25;

export const MAILBOX_ACCOUNT_EMAIL_MAX_LENGTH = 255;
export const MAILBOX_PROVIDER_ID_MAX_LENGTH = 255;
export const MAILBOX_CURSOR_MAX_LENGTH = 64;
export const MAILBOX_ERROR_MAX_LENGTH = 500;

/**
 * `gmail.send` is *sensitive*; `gmail.readonly` is *restricted* — verification
 * plus an annual third-party security assessment before a public launch.
 *
 * **`gmail.modify` is deliberately absent.** It would let this app write to a
 * mailbox it only ever reads from, and there is no answer to an assessor asking
 * why we hold it. There is no narrower read scope: Google publishes nothing like
 * "read only the threads my app created", which is exactly why the usage has to
 * be narrow instead — see `MailboxProvider`, which cannot search an inbox.
 */
export const GMAIL_SCOPES: readonly string[] = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

/**
 * The request's own machine. `confirmed` and `cancelled` are terminal: a deal
 * that was struck is not un-struck by a status write, and a cancelled request
 * is reopened by creating another one.
 */
export const PURCHASE_REQUEST_TRANSITIONS: Readonly<
  Record<PurchaseRequestStatus, readonly PurchaseRequestStatus[]>
> = {
  [PurchaseRequestStatus.Draft]: [
    PurchaseRequestStatus.Sent,
    PurchaseRequestStatus.Cancelled,
  ],
  [PurchaseRequestStatus.Sent]: [
    PurchaseRequestStatus.Replied,
    PurchaseRequestStatus.Cancelled,
  ],
  [PurchaseRequestStatus.Replied]: [
    PurchaseRequestStatus.Confirmed,
    PurchaseRequestStatus.Cancelled,
  ],
  [PurchaseRequestStatus.Confirmed]: [],
  [PurchaseRequestStatus.Cancelled]: [],
};
