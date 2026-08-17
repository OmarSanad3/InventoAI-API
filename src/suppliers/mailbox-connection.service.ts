import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { EnvironmentVariables } from '../config/env.validation';
import { RedisService } from '../redis/redis.service';
import { StoreService } from '../site-builder/store.service';
import { ConnectMailboxDto } from './dto/connect-mailbox.dto';
import { MailboxConnection } from './entities/mailbox-connection.entity';
import { MailboxConnectionStatus } from './enums/mailbox-connection-status.enum';
import {
  MAILBOX_PROVIDER,
  MailboxGrantRevokedError,
  type MailboxGrant,
  type MailboxProvider,
} from './mailbox/mailbox.provider';
import {
  MAILBOX_ERROR_MAX_LENGTH,
  MAILBOX_STATE_KEY_PREFIX,
  MAILBOX_STATE_TTL_SECONDS,
} from './suppliers.constants';
import {
  decryptSecret,
  encryptSecret,
  isUsableCipherKey,
  matchesSecret,
} from './utils/secret-cipher.util';

/** 32 bytes of base64url — long enough that guessing it is not a strategy. */
const STATE_BYTES = 32;

/**
 * The owner's mailbox, connected once and revocable.
 *
 * Everything about this service is shaped by one fact: it holds a credential for
 * property that is not ours. So the refresh token is encrypted before it reaches
 * Postgres, its column is `select: false`, it is decrypted only in the one method
 * that hands it to the provider, and it is never logged, never returned by a DTO
 * and never written to `lastError`.
 *
 * **Losing access is an ordinary state, not an exception.** In Google's testing
 * publishing status a refresh token expires every 7 days by design, so a
 * connection that has gone dead has to be a row the dashboard can render and the
 * sync can skip — the shape `vectorSearchAvailable: false` already has. The
 * paste route keeps working throughout, which is what makes that acceptable
 * rather than a broken feature.
 */
@Injectable()
export class MailboxConnectionService {
  private readonly logger = new Logger(MailboxConnectionService.name);

  constructor(
    @InjectRepository(MailboxConnection)
    private readonly connectionRepository: Repository<MailboxConnection>,
    @Inject(MAILBOX_PROVIDER)
    private readonly mailboxProvider: MailboxProvider,
    private readonly storeService: StoreService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * Where to send the owner to consent.
   *
   * Both preconditions are checked **before** the URL is built, because the
   * alternative is spending an owner's consent — and Google's unverified-app
   * warning — only to fail on the callback with nowhere to put the grant.
   */
  async startConnect(
    user: JwtPayload,
  ): Promise<{ consentUrl: string; state: string }> {
    const store = await this.storeService.resolveCallerStore(user);
    this.assertConfigured();

    const state = randomBytes(STATE_BYTES).toString('base64url');
    await this.redisService.setex(
      this.buildStateKey(store.id),
      MAILBOX_STATE_TTL_SECONDS,
      state,
    );

    const existing = await this.findForStore(store.id);

    return {
      consentUrl: this.mailboxProvider.buildConsentUrl({
        state,
        // Prefills the account picker with the address already connected, so a
        // reconnect does not silently attach a different mailbox.
        loginHint: existing?.accountEmail ?? null,
      }),
      state,
    };
  }

  /**
   * The callback: the one-time code becomes a stored grant.
   *
   * The `state` check is the CSRF guard, and it is why this route is worth
   * having at all rather than accepting a bare code: without it, anybody who can
   * make an owner's browser issue one request could attach *their* mailbox to
   * the owner's store, and every purchase request would then be sent from it.
   */
  async completeConnect(
    user: JwtPayload,
    dto: ConnectMailboxDto,
  ): Promise<MailboxConnection> {
    const store = await this.storeService.resolveCallerStore(user);
    this.assertConfigured();

    const stateKey = this.buildStateKey(store.id);
    const expected = await this.redisService.get(stateKey);
    if (!expected || !matchesSecret(expected, dto.state)) {
      throw new BadRequestException(
        'This connection attempt has expired or does not match — please start again',
      );
    }
    // Single-use: a code replayed against a consumed state is refused.
    await this.redisService.del(stateKey);

    const grant = await this.mailboxProvider
      .exchangeCode({ code: dto.code })
      .catch((err: unknown) => {
        this.logger.warn(
          `Mailbox connect failed for ${store.slug}: ${String(err)}`,
        );
        throw new BadRequestException(
          'Google did not accept this authorization — please try connecting again',
        );
      });

    // Read *now*, so the first sync sees only what arrives after the owner
    // connected. Starting from nothing would walk the whole mailbox history.
    const cursor = await this.mailboxProvider
      .readCurrentCursor(grant)
      .catch(() => null);

    const connection =
      (await this.connectionRepository.findOne({
        where: { storeId: store.id },
      })) ?? this.connectionRepository.create({ storeId: store.id });

    connection.provider = this.mailboxProvider.name;
    connection.accountEmail = grant.accountEmail;
    connection.refreshTokenCipher = this.encrypt(grant.refreshToken);
    connection.scopes = [...grant.scopes];
    connection.syncCursor = cursor;
    connection.status = MailboxConnectionStatus.Connected;
    connection.lastError = null;
    connection.connectedAt = new Date();

    await this.connectionRepository.save(connection);

    this.logger.log(
      `${store.slug} connected the mailbox ${grant.accountEmail} for supplier mail`,
    );

    return this.requireForStore(store.id);
  }

  /**
   * Forgets the grant. The requests already sent keep their thread ids, so a
   * reconnect picks their replies up again rather than starting a new history.
   *
   * This deletes **our** copy and does not call Google's revoke endpoint: with
   * the token gone we cannot use the grant, and revoking a shared consent would
   * also take away the Google Sign-In the owner may log in with. Withdrawing it
   * at Google is the owner's own switch, in their account settings.
   */
  async disconnect(user: JwtPayload): Promise<void> {
    const store = await this.storeService.resolveCallerStore(user);

    await this.connectionRepository.delete({ storeId: store.id });
    await this.redisService.del(this.buildStateKey(store.id));
  }

  /** The dashboard's read. Never includes the token: the column is `select: false`. */
  async findForStore(storeId: string): Promise<MailboxConnection | null> {
    return this.connectionRepository.findOne({ where: { storeId } });
  }

  async findForCaller(user: JwtPayload): Promise<{
    connection: MailboxConnection | null;
    isSupported: boolean;
  }> {
    const store = await this.storeService.resolveCallerStore(user);
    return {
      connection: await this.findForStore(store.id),
      isSupported: this.isSupported(),
    };
  }

  /** Every store whose mailbox is usable — the sync's candidate list. */
  async listConnected(): Promise<MailboxConnection[]> {
    return this.connectionRepository.find({
      where: { status: MailboxConnectionStatus.Connected },
    });
  }

  /**
   * The grant, decrypted, or `null` when this deployment cannot use it.
   *
   * A ciphertext that will not decrypt is treated as a dead connection rather
   * than an error to retry: it means the encryption key changed, and no number of
   * hourly retries will change that back. The row is marked `expired` — ours, not
   * Google's — so the dashboard can say something true about why.
   */
  async resolveGrant(
    connection: MailboxConnection,
  ): Promise<MailboxGrant | null> {
    const stored = await this.connectionRepository.findOne({
      where: { id: connection.id },
      select: {
        id: true,
        accountEmail: true,
        scopes: true,
        refreshTokenCipher: true,
      },
    });
    if (!stored?.refreshTokenCipher) {
      return null;
    }

    const keyHex = this.readEncryptionKey();

    try {
      return {
        refreshToken: decryptSecret({
          ciphertext: stored.refreshTokenCipher,
          keyHex,
        }),
        accountEmail: stored.accountEmail,
        scopes: stored.scopes ?? [],
      };
    } catch (err) {
      this.logger.error(
        `Could not decrypt the stored mailbox token for store ${connection.storeId}: ${String(err)}`,
      );
      await this.markUnusable(
        connection,
        MailboxConnectionStatus.Expired,
        'The stored mailbox credential could not be read on this server',
      );
      return null;
    }
  }

  /** A successful pass: the watermark moves and the error clears. */
  async recordSync(
    connection: MailboxConnection,
    cursor: string | null,
  ): Promise<void> {
    await this.connectionRepository.update(
      { id: connection.id },
      { syncCursor: cursor, lastSyncedAt: new Date(), lastError: null },
    );
  }

  /** A pass that failed for a reason that may not recur. The grant survives. */
  async recordSyncFailure(
    connection: MailboxConnection,
    reason: string,
  ): Promise<void> {
    await this.connectionRepository.update(
      { id: connection.id },
      { lastSyncedAt: new Date(), lastError: truncate(reason) },
    );
  }

  /**
   * The grant is gone. Polling stops here — retrying an `invalid_grant` an hour
   * later fails identically, and a dead grant polled hourly forever is exactly
   * what an assessor asks about.
   */
  async markRevoked(
    connection: MailboxConnection,
    error: MailboxGrantRevokedError,
  ): Promise<void> {
    await this.markUnusable(
      connection,
      MailboxConnectionStatus.Revoked,
      `${error.message} — reconnect the mailbox to resume automatic replies`,
    );
  }

  /** Whether this deployment offers the feature at all. */
  isSupported(): boolean {
    return (
      this.mailboxProvider.isConfigured() &&
      isUsableCipherKey(this.readEncryptionKey())
    );
  }

  private async markUnusable(
    connection: MailboxConnection,
    status: MailboxConnectionStatus,
    reason: string,
  ): Promise<void> {
    await this.connectionRepository.update(
      { id: connection.id },
      { status, lastError: truncate(reason) },
    );
  }

  private async requireForStore(storeId: string): Promise<MailboxConnection> {
    const connection = await this.findForStore(storeId);
    if (!connection) {
      throw new ServiceUnavailableException(
        'The mailbox connection could not be saved, please try again',
      );
    }
    return connection;
  }

  /**
   * Two 503s rather than one, because the fixes are different people's jobs: a
   * missing client secret is a deployment that has not set the feature up, and an
   * unusable key is a deployment that has set it up wrongly.
   */
  private assertConfigured(): void {
    if (!this.mailboxProvider.isConfigured()) {
      throw new ServiceUnavailableException(
        'Mailbox sending is not configured on this server',
      );
    }
    if (!isUsableCipherKey(this.readEncryptionKey())) {
      throw new ServiceUnavailableException(
        'This server cannot store mailbox credentials securely, so it will not ask for them',
      );
    }
  }

  private encrypt(refreshToken: string): string {
    return encryptSecret({
      plaintext: refreshToken,
      keyHex: this.readEncryptionKey(),
    });
  }

  private readEncryptionKey(): string {
    return this.configService.get('MAILBOX_TOKEN_ENCRYPTION_KEY', {
      infer: true,
    });
  }

  private buildStateKey(storeId: string): string {
    return `${MAILBOX_STATE_KEY_PREFIX}${storeId}`;
  }
}

function truncate(reason: string): string {
  return reason.length > MAILBOX_ERROR_MAX_LENGTH
    ? `${reason.slice(0, MAILBOX_ERROR_MAX_LENGTH - 1)}…`
    : reason;
}
