import type { MailAddress } from './mime-message.util';

/**
 * The port a store's own mailbox is reached through — for sending as the owner,
 * and for reading what came back.
 *
 * It exists for the reason `EmbeddingProvider` and `WeatherProvider` do: the
 * adapter is a third party. One adapter ships, `GmailProvider`, and the two that
 * are already known to be coming shape the interface rather than being
 * discovered by it — Outlook is Microsoft Graph with its own OAuth review, and a
 * cPanel mailbox is plain IMAP with a password the owner pastes in.
 *
 * Two things are deliberately **not** in this interface:
 *
 * - **No `historyId`.** The sync watermark is an opaque `cursor` here, because
 *   Gmail's `historyId`, Graph's `deltaLink` and IMAP's `UIDVALIDITY`/`UID` pair
 *   are three different things that answer the same question. A caller that
 *   understood any one of them would be an adapter in the wrong file.
 * - **No search.** `fetchReplies` takes the thread ids we created and nothing
 *   else. Reading a mailbox is a *restricted* Google scope: the grant is total
 *   and the usage has to be visibly narrow, so there is no method here that
 *   could go looking through an inbox even if a caller wanted to.
 */

/** The one adapter that ships, and the column value that records it. */
export enum MailboxProviderName {
  Gmail = 'gmail',
}

/**
 * What a completed consent gives us, and what gets stored.
 *
 * The refresh token is the whole of it — a key to a human's mail, encrypted
 * before it reaches Postgres. Access tokens are never stored: they last an hour,
 * and a cached one is a second copy of a credential to keep safe for no gain.
 */
export interface MailboxGrant {
  readonly refreshToken: string;
  readonly accountEmail: string;
  readonly scopes: readonly string[];
}

export interface OutboundEmail {
  readonly from: MailAddress;
  readonly to: MailAddress;
  readonly replyToEmail: string | null;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface SentEmail {
  readonly providerMessageId: string;
  /** The correlation key. Captured at send time; a reply lands in this thread. */
  readonly threadId: string;
}

export interface InboundReply {
  readonly providerMessageId: string;
  readonly threadId: string;
  readonly fromEmail: string;
  readonly receivedAt: Date;
  /** Already de-quoted and capped — what the supplier actually typed. */
  readonly body: string;
}

export interface ReplyQuery {
  readonly grant: MailboxGrant;
  /** Only these. There is no other way to ask. */
  readonly threadIds: readonly string[];
  /** The watermark from the last successful sync, or `null` for a first pass. */
  readonly cursor: string | null;
}

export interface ReplyPage {
  readonly replies: readonly InboundReply[];
  /**
   * The watermark to store **after** the replies are committed. A caller that
   * saved this first and crashed would skip a reply forever.
   */
  readonly cursor: string | null;
  /** True when the cursor was too old to use and every thread was re-read. */
  readonly wasCursorReset: boolean;
}

/**
 * The grant is gone: the owner revoked it in their Google account, changed their
 * password, or the refresh token simply expired — which in Google's *testing*
 * publishing status happens every 7 days by design.
 *
 * A distinct type because the response is distinct: stop polling and ask the
 * owner to reconnect. Retrying is pointless, and treating it as a transient
 * error would poll a dead grant hourly forever.
 */
export class MailboxGrantRevokedError extends Error {
  constructor(reason: string) {
    super(`The mailbox grant is no longer valid: ${reason}`);
    this.name = 'MailboxGrantRevokedError';
  }
}

export const MAILBOX_PROVIDER = Symbol('MAILBOX_PROVIDER');

export interface MailboxProvider {
  readonly name: MailboxProviderName;

  /**
   * Whether this adapter has the configuration it needs. False is an ordinary
   * state, not an error: a deployment with no client secret simply has no
   * mailbox feature, and every route says so rather than throwing.
   */
  isConfigured(): boolean;

  /** Where to send the owner to consent. `state` is the CSRF guard. */
  buildConsentUrl(input: { state: string; loginHint?: string | null }): string;

  /** The one-time code from the callback, exchanged for a durable grant. */
  exchangeCode(input: { code: string }): Promise<MailboxGrant>;

  /**
   * Sends **as the owner**, so the reply comes back to them. Returns the thread
   * the message opened, which is the only reason this returns anything at all.
   */
  sendEmail(input: {
    grant: MailboxGrant;
    email: OutboundEmail;
  }): Promise<SentEmail>;

  /**
   * New inbound messages in the given threads. Messages the owner sent are
   * excluded by the adapter — our own request is in that thread too, and reading
   * it back as a reply would extract the quantity we asked for as the one we
   * were quoted.
   *
   * **Throws `MailboxGrantRevokedError`** when the grant is dead, and an
   * ordinary `Error` for anything transient.
   */
  fetchReplies(query: ReplyQuery): Promise<ReplyPage>;

  /**
   * The mailbox's current position, for a connection that has just been made.
   * Starting from `null` would replay the whole mailbox history; starting from
   * *now* means we only ever see what arrives after the owner connected.
   */
  readCurrentCursor(grant: MailboxGrant): Promise<string | null>;
}
