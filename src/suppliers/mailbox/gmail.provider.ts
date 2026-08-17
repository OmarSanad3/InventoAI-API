import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  GMAIL_SCOPES,
  MAILBOX_API_TIMEOUT_MS,
  MAILBOX_MAX_HISTORY_PAGES,
  MAILBOX_MAX_REPLIES_PER_SYNC,
} from '../suppliers.constants';
import {
  MailboxGrantRevokedError,
  MailboxProviderName,
  type InboundReply,
  type MailboxGrant,
  type MailboxProvider,
  type OutboundEmail,
  type ReplyPage,
  type ReplyQuery,
  type SentEmail,
} from './mailbox.provider';
import { buildMimeMessage, encodeMessageForApi } from './mime-message.util';
import {
  extractPlainTextBody,
  stripQuotedReply,
  type MailPartLike,
} from './reply-text.util';

/** Labels that mean "this message is not a supplier's reply". */
const EXCLUDED_LABELS = new Set(['SENT', 'DRAFT', 'CHAT', 'TRASH', 'SPAM']);

/** Gmail says a watermark is too old with a 404 on the history endpoint. */
const HISTORY_GONE = 404;

/** The shapes read back from Gmail. Nothing is trusted until it is checked. */
interface GmailProfile {
  emailAddress?: unknown;
  historyId?: unknown;
}

interface GmailMessageRef {
  id?: unknown;
  threadId?: unknown;
  labelIds?: unknown;
}

interface GmailHistoryResponse {
  history?: unknown;
  historyId?: unknown;
  nextPageToken?: unknown;
}

interface GmailMessage {
  id?: unknown;
  threadId?: unknown;
  labelIds?: unknown;
  internalDate?: unknown;
  payload?: MailPartLike & { headers?: unknown };
}

interface GmailThread {
  messages?: unknown;
}

/**
 * Gmail over its REST API, with `google-auth-library` doing the OAuth and plain
 * `fetch` doing the rest.
 *
 * **No `googleapis` package.** The full client is tens of megabytes of generated
 * surface for four endpoints — send, profile, history, messages — and the
 * project already depends on `google-auth-library` for Google Sign-In. It is the
 * same call `OpenMeteoWeatherProvider` made, and the same one the chatbot did
 * not make: an SDK earns its place when it does something hard, and here the
 * hard part is the token refresh, which is precisely the part already installed.
 *
 * **Access tokens are never stored.** They last an hour; a cached one is a
 * second copy of a live credential to keep safe, in exchange for saving a
 * round trip on a job that runs every few minutes.
 */
@Injectable()
export class GmailProvider implements MailboxProvider {
  readonly name = MailboxProviderName.Gmail;
  private readonly logger = new Logger(GmailProvider.name);

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * A deployment with no client secret has no mailbox feature — which is every
   * deployment until somebody fills it in, including a fresh clone of this
   * repository. That is an ordinary state and every caller reports it as one.
   */
  isConfigured(): boolean {
    return Boolean(
      this.readConfig('GOOGLE_CLIENT_ID') &&
      this.readConfig('GOOGLE_CLIENT_SECRET') &&
      this.readConfig('GOOGLE_MAILBOX_REDIRECT_URI'),
    );
  }

  /**
   * `access_type: offline` is what returns a refresh token at all, and
   * `prompt: consent` is what returns one *again* for an owner who has already
   * consented — without it, a reconnect after a revoke yields an access token
   * and nothing durable.
   *
   * `include_granted_scopes` makes this the incremental consent the Google
   * Sign-In branch paid for: the owner keeps the identity scopes they already
   * granted rather than re-approving them.
   */
  buildConsentUrl({
    state,
    loginHint,
  }: {
    state: string;
    loginHint?: string | null;
  }): string {
    return this.createOAuthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: [...GMAIL_SCOPES],
      state,
      ...(loginHint ? { login_hint: loginHint } : {}),
    });
  }

  /**
   * The grant, plus the address it belongs to.
   *
   * The address comes from Gmail's own profile endpoint rather than from an
   * `openid`/`userinfo` scope, because the scope list is the thing an assessor
   * reads: asking for a profile scope to learn an address we are about to be
   * granted the whole mailbox of would be one more scope for nothing.
   */
  async exchangeCode({ code }: { code: string }): Promise<MailboxGrant> {
    const client = this.createOAuthClient();

    const { tokens } = await client.getToken(code).catch((err: unknown) => {
      throw new Error(`Google refused the authorization code: ${String(err)}`);
    });

    if (!tokens.refresh_token) {
      // Almost always a re-consent without `prompt: consent`, which we do send —
      // so if it happens, it is worth an error the owner can act on rather than
      // a connection row that can never refresh.
      throw new Error(
        'Google returned no refresh token; the mailbox cannot be kept connected',
      );
    }

    const grant: MailboxGrant = {
      refreshToken: tokens.refresh_token,
      accountEmail: '',
      scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
    };

    const profile = await this.request<GmailProfile>(grant, 'profile');
    const accountEmail =
      typeof profile.emailAddress === 'string' ? profile.emailAddress : '';
    if (!accountEmail) {
      throw new Error('Google returned no address for the connected mailbox');
    }

    return { ...grant, accountEmail: accountEmail.toLowerCase() };
  }

  async readCurrentCursor(grant: MailboxGrant): Promise<string | null> {
    const profile = await this.request<GmailProfile>(grant, 'profile');
    return readId(profile.historyId);
  }

  async sendEmail({
    grant,
    email,
  }: {
    grant: MailboxGrant;
    email: OutboundEmail;
  }): Promise<SentEmail> {
    const raw = encodeMessageForApi(buildMimeMessage(email));

    const sent = await this.request<GmailMessageRef>(grant, 'messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw }),
    });

    const providerMessageId = readId(sent.id);
    const threadId = readId(sent.threadId);
    if (!providerMessageId || !threadId) {
      throw new Error('Gmail accepted the message but returned no thread id');
    }

    return { providerMessageId, threadId };
  }

  /**
   * The watermark, and the fallback when it has expired.
   *
   * Gmail keeps history for about a week, so a store nobody synced over a
   * holiday gets a 404 on its `startHistoryId`. That is not an error: the thread
   * ids are the durable correlation key, so every thread is simply re-read and
   * the deduplication in `SupplierReplyService.ingest` absorbs what has already
   * been seen. This is the reason `ingest` had to become insert-if-absent
   * *before* this cron was switched on.
   */
  async fetchReplies({
    grant,
    threadIds,
    cursor,
  }: ReplyQuery): Promise<ReplyPage> {
    if (threadIds.length === 0) {
      return { replies: [], cursor, wasCursorReset: false };
    }

    if (!cursor) {
      return this.readThreads(grant, threadIds, false);
    }

    try {
      return await this.readHistory(grant, threadIds, cursor);
    } catch (err) {
      if (err instanceof GmailHttpError && err.status === HISTORY_GONE) {
        this.logger.warn(
          `Gmail history watermark ${cursor} has expired; re-reading ${threadIds.length} thread(s)`,
        );
        return this.readThreads(grant, threadIds, true);
      }
      throw err;
    }
  }

  /**
   * `history.list` from the watermark, keeping only messages that landed in a
   * thread we opened.
   *
   * The cursor returned is the one Gmail reports for the pages actually walked,
   * so stopping at `MAILBOX_MAX_HISTORY_PAGES` leaves the rest for the next pass
   * instead of skipping it.
   */
  private async readHistory(
    grant: MailboxGrant,
    threadIds: readonly string[],
    cursor: string,
  ): Promise<ReplyPage> {
    const wanted = new Set(threadIds);
    const messageIds: string[] = [];
    let latestCursor = cursor;
    let pageToken: string | null = null;
    let pages = 0;

    do {
      const params = new URLSearchParams({
        startHistoryId: cursor,
        historyTypes: 'messageAdded',
      });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }

      const page = await this.request<GmailHistoryResponse>(
        grant,
        `history?${params.toString()}`,
      );

      latestCursor = readId(page.historyId) ?? latestCursor;
      pageToken = readId(page.nextPageToken);
      pages += 1;

      for (const ref of collectAddedMessages(page.history)) {
        if (!wanted.has(ref.threadId) || messageIds.includes(ref.id)) {
          continue;
        }
        messageIds.push(ref.id);
      }
    } while (pageToken && pages < MAILBOX_MAX_HISTORY_PAGES);

    const replies = await this.readMessages(grant, messageIds);
    return { replies, cursor: latestCursor, wasCursorReset: false };
  }

  /** Every message in every thread we know about — the no-watermark path. */
  private async readThreads(
    grant: MailboxGrant,
    threadIds: readonly string[],
    wasCursorReset: boolean,
  ): Promise<ReplyPage> {
    const replies: InboundReply[] = [];

    for (const threadId of threadIds) {
      if (replies.length >= MAILBOX_MAX_REPLIES_PER_SYNC) {
        break;
      }

      const thread = await this.request<GmailThread>(
        grant,
        `threads/${encodeURIComponent(threadId)}?format=full`,
      ).catch((err: unknown) => {
        // A thread the owner deleted is not a reason to fail the whole pass.
        this.logger.warn(`Could not read thread ${threadId}: ${String(err)}`);
        return null;
      });

      for (const message of asArray(thread?.messages)) {
        const reply = this.toReply(message as GmailMessage);
        if (reply) {
          replies.push(reply);
        }
      }
    }

    // The cursor is read *after* the threads, so anything that arrives during
    // this pass is caught by the next one rather than jumped over.
    const cursor = await this.readCurrentCursor(grant).catch(() => null);
    return { replies, cursor, wasCursorReset };
  }

  private async readMessages(
    grant: MailboxGrant,
    messageIds: readonly string[],
  ): Promise<InboundReply[]> {
    const replies: InboundReply[] = [];

    for (const id of messageIds.slice(0, MAILBOX_MAX_REPLIES_PER_SYNC)) {
      const message = await this.request<GmailMessage>(
        grant,
        `messages/${encodeURIComponent(id)}?format=full`,
      ).catch((err: unknown) => {
        this.logger.warn(`Could not read message ${id}: ${String(err)}`);
        return null;
      });

      const reply = message && this.toReply(message);
      if (reply) {
        replies.push(reply);
      }
    }

    return replies;
  }

  /**
   * A Gmail message reduced to a supplier's words, or `null` when it is not one.
   *
   * Three things are dropped here, and the first matters most: **our own sent
   * message is in the thread too**. Reading it back as a reply would hand the
   * extractor the request we wrote — the one that names the quantity we asked
   * for — and store our own number as the supplier's quote. Auto-replies and
   * bounces are dropped for the plainer reason that they contain no offer.
   */
  private toReply(message: GmailMessage): InboundReply | null {
    const providerMessageId = readId(message.id);
    const threadId = readId(message.threadId);
    if (!providerMessageId || !threadId) {
      return null;
    }

    const labels = asArray(message.labelIds).filter(
      (label): label is string => typeof label === 'string',
    );
    if (labels.some((label) => EXCLUDED_LABELS.has(label))) {
      return null;
    }

    const headers = readHeaders(message.payload?.headers);
    if (isAutomated(headers)) {
      return null;
    }

    const fromEmail = readEmailAddress(headers.get('from') ?? '');
    if (!fromEmail) {
      return null;
    }

    const body = stripQuotedReply(extractPlainTextBody(message.payload));
    if (!body) {
      return null;
    }

    return {
      providerMessageId,
      threadId,
      fromEmail,
      receivedAt: readInternalDate(message.internalDate),
      body,
    };
  }

  /**
   * One authenticated Gmail call.
   *
   * The refresh happens per call rather than per pass: `google-auth-library`
   * caches the access token on the client for its lifetime, and a dead grant has
   * to surface as `MailboxGrantRevokedError` from wherever it is discovered.
   */
  private async request<T>(
    grant: MailboxGrant,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const accessToken = await this.resolveAccessToken(grant);
    const base = this.readConfig('GOOGLE_GMAIL_API_BASE_URL').replace(
      /\/+$/,
      '',
    );

    const response = await fetch(`${base}/users/me/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(MAILBOX_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // A 401 on a token we just minted means the grant behind it is gone.
      if (response.status === 401) {
        throw new MailboxGrantRevokedError(`Gmail rejected the access token`);
      }
      throw new GmailHttpError(response.status, path, detail);
    }

    return (await response.json()) as T;
  }

  /**
   * `invalid_grant` is the one error that is not worth retrying: the owner
   * revoked us, changed their password, or — in Google's *testing* publishing
   * status — simply let the 7-day refresh token expire. Retrying an hour later
   * fails identically, so it is turned into the typed error the sync stops on.
   */
  private async resolveAccessToken(grant: MailboxGrant): Promise<string> {
    const client = this.createOAuthClient();
    client.setCredentials({ refresh_token: grant.refreshToken });

    try {
      const { token } = await client.getAccessToken();
      if (!token) {
        throw new Error('Google returned no access token');
      }
      return token;
    } catch (err) {
      const message = String(err);
      if (/invalid_grant|unauthorized_client|invalid_client/i.test(message)) {
        throw new MailboxGrantRevokedError(message);
      }
      throw new Error(`Could not refresh the mailbox access token: ${message}`);
    }
  }

  private createOAuthClient(): OAuth2Client {
    return new OAuth2Client({
      clientId: this.readConfig('GOOGLE_CLIENT_ID'),
      clientSecret: this.readConfig('GOOGLE_CLIENT_SECRET'),
      redirectUri: this.readConfig('GOOGLE_MAILBOX_REDIRECT_URI'),
    });
  }

  private readConfig(
    key:
      | 'GOOGLE_CLIENT_ID'
      | 'GOOGLE_CLIENT_SECRET'
      | 'GOOGLE_MAILBOX_REDIRECT_URI'
      | 'GOOGLE_GMAIL_API_BASE_URL',
  ): string {
    return this.configService.get(key, { infer: true }).trim();
  }
}

/** A non-2xx from Gmail, carrying the status the caller may want to branch on. */
class GmailHttpError extends Error {
  constructor(
    readonly status: number,
    path: string,
    detail: string,
  ) {
    super(`Gmail answered ${status} for ${path}: ${detail.slice(0, 200)}`);
    this.name = 'GmailHttpError';
  }
}

/** `history[].messagesAdded[].message`, flattened and checked. */
function collectAddedMessages(
  history: unknown,
): { id: string; threadId: string }[] {
  const refs: { id: string; threadId: string }[] = [];

  for (const entry of asArray(history)) {
    const added = asArray((entry as { messagesAdded?: unknown }).messagesAdded);
    for (const item of added) {
      const message = (item as { message?: GmailMessageRef }).message;
      const id = readId(message?.id);
      const threadId = readId(message?.threadId);
      if (!id || !threadId) {
        continue;
      }

      const labels = asArray(message?.labelIds);
      if (
        labels.some(
          (label) => typeof label === 'string' && EXCLUDED_LABELS.has(label),
        )
      ) {
        continue;
      }

      refs.push({ id, threadId });
    }
  }

  return refs;
}

function readHeaders(raw: unknown): Map<string, string> {
  const headers = new Map<string, string>();

  for (const entry of asArray(raw)) {
    const { name, value } = entry as { name?: unknown; value?: unknown };
    if (typeof name === 'string' && typeof value === 'string') {
      headers.set(name.toLowerCase(), value);
    }
  }

  return headers;
}

/** A vacation responder, a bounce, or a list — never an offer. */
function isAutomated(headers: Map<string, string>): boolean {
  const autoSubmitted = headers.get('auto-submitted') ?? '';
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') {
    return true;
  }
  if (headers.has('x-autoreply') || headers.has('x-autorespond')) {
    return true;
  }
  if (headers.has('list-id') || headers.has('precedence')) {
    return true;
  }

  const from = (headers.get('from') ?? '').toLowerCase();
  return /mailer-daemon|postmaster|no-?reply/.test(from);
}

/** `Layali <ops@layali.test>` → `ops@layali.test`. */
function readEmailAddress(value: string): string | null {
  const angled = /<([^>]+)>/.exec(value);
  const candidate = (angled ? angled[1] : value).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(candidate) ? candidate : null;
}

/** Gmail's `internalDate` is epoch milliseconds, as a string. */
function readInternalDate(value: unknown): Date {
  const millis = Number(value);
  return Number.isFinite(millis) && millis > 0 ? new Date(millis) : new Date();
}

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
