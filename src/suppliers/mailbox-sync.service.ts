import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { RedisService } from '../redis/redis.service';
import { Store } from '../site-builder/entities/store.entity';
import { MailboxConnection } from './entities/mailbox-connection.entity';
import { SupplierOffer } from './entities/supplier-offer.entity';
import { PurchaseRequestStatus } from './enums/purchase-request-status.enum';
import { SupplierOfferStatus } from './enums/supplier-offer-status.enum';
import { MailboxConnectionService } from './mailbox-connection.service';
import {
  MAILBOX_PROVIDER,
  MailboxGrantRevokedError,
  type InboundReply,
  type MailboxProvider,
  type ReplyPage,
} from './mailbox/mailbox.provider';
import {
  MAILBOX_MAX_REPLIES_PER_SYNC,
  MAILBOX_SYNC_LOCK_KEY,
  MAILBOX_SYNC_LOCK_TTL_SECONDS,
} from './suppliers.constants';
import { SupplierReplyService } from './supplier-reply.service';

/** What one store's pass did, for the log line and for the tests. */
export interface MailboxSyncOutcome {
  readonly storeId: string;
  readonly threadsWatched: number;
  readonly repliesRead: number;
  readonly repliesSkipped: number;
  readonly wasCursorReset: boolean;
}

/**
 * The pass that reads supplier replies out of each owner's mailbox.
 *
 * **It is a watermark, not a search.** The provider is asked for new messages in
 * the threads we opened, from the cursor of the last successful pass — never for
 * "mail that looks like a quote". That is a security posture rather than an
 * optimisation: reading a mailbox is a *restricted* Google scope, the grant is
 * total, and the usage has to be visibly narrow enough to explain to an assessor.
 * `MailboxProvider` has no method that could search an inbox.
 *
 * **Only stores with an open request are polled.** A store whose every request is
 * confirmed or cancelled has nothing that can be replied to, and holding an
 * unused grant while polling it hourly is exactly what an assessment asks about.
 *
 * A cron rather than a queue, for the third time in this project and the same
 * reason: the work is state in a table. A missed pass is picked up by the next
 * one, because the cursor did not move.
 */
@Injectable()
export class MailboxSyncService {
  private readonly logger = new Logger(MailboxSyncService.name);
  private readonly instanceId = randomUUID();

  constructor(
    @InjectRepository(SupplierOffer)
    private readonly offerRepository: Repository<SupplierOffer>,
    @InjectRepository(MailboxConnection)
    private readonly connectionRepository: Repository<MailboxConnection>,
    @Inject(MAILBOX_PROVIDER)
    private readonly mailboxProvider: MailboxProvider,
    private readonly connectionService: MailboxConnectionService,
    private readonly replyService: SupplierReplyService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Every ten minutes: often enough that a supplier's answer is on screen while
   * the owner is still thinking about it, rare enough to stay far inside Gmail's
   * quota with one call per store per pass.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async runScheduledSync(): Promise<void> {
    if (!this.connectionService.isSupported()) {
      return;
    }

    const hasLock = await this.redisService.setIfAbsent(
      MAILBOX_SYNC_LOCK_KEY,
      this.instanceId,
      MAILBOX_SYNC_LOCK_TTL_SECONDS,
    );
    if (!hasLock) {
      return;
    }

    try {
      await this.syncAll();
    } catch (err) {
      this.logger.error(`Mailbox sync pass failed: ${String(err)}`);
    } finally {
      await this.redisService.del(MAILBOX_SYNC_LOCK_KEY).catch(() => undefined);
    }
  }

  /** Public so the pass can be run directly, the way the Advisor's is tested. */
  async syncAll(): Promise<MailboxSyncOutcome[]> {
    const connections = await this.connectionService.listConnected();
    const outcomes: MailboxSyncOutcome[] = [];

    for (const connection of connections) {
      // One store's failure is reported and stepped over, as in the Advisor's
      // hourly pass: a timeout on store four must not cost store five its
      // replies.
      const outcome = await this.syncStore(connection).catch((err: unknown) => {
        this.logger.warn(
          `Mailbox sync failed for store ${connection.storeId}: ${String(err)}`,
        );
        return null;
      });

      if (outcome) {
        outcomes.push(outcome);
      }
    }

    return outcomes;
  }

  /**
   * One store: find the threads worth watching, read what is new in them, and
   * move the watermark **only if** the pass is safe to consider finished.
   */
  async syncStore(
    connection: MailboxConnection,
  ): Promise<MailboxSyncOutcome | null> {
    const store = await this.loadStore(connection);
    if (!store) {
      return null;
    }

    const openOffers = await this.findOpenThreadOffers(connection.storeId);
    if (openOffers.length === 0) {
      // Nothing can be replied to. Not an error, and not a reason to call Google.
      return null;
    }

    const grant = await this.connectionService.resolveGrant(connection);
    if (!grant) {
      // `resolveGrant` has already marked the row; it is unusable, not broken.
      return null;
    }

    const threadIds = [
      ...new Set(
        openOffers
          .map((offer) => offer.mailboxThreadId)
          .filter((id): id is string => id !== null),
      ),
    ];

    let page: ReplyPage;
    try {
      page = await this.mailboxProvider.fetchReplies({
        grant,
        threadIds,
        cursor: connection.syncCursor,
      });
    } catch (err) {
      if (err instanceof MailboxGrantRevokedError) {
        await this.connectionService.markRevoked(connection, err);
        this.logger.warn(
          `Store ${connection.storeId} must reconnect its mailbox: ${err.message}`,
        );
        return null;
      }
      throw err;
    }

    const byThread = new Map(
      openOffers
        .filter((offer) => offer.mailboxThreadId !== null)
        .map((offer) => [offer.mailboxThreadId as string, offer]),
    );

    let repliesRead = 0;
    let repliesSkipped = 0;
    let hadUnexpectedFailure = false;

    for (const reply of page.replies.slice(0, MAILBOX_MAX_REPLIES_PER_SYNC)) {
      const offer = byThread.get(reply.threadId);
      if (!offer) {
        continue;
      }

      const result = await this.applyReply(store, offer, reply);
      if (result === 'read') {
        repliesRead += 1;
      } else if (result === 'skipped') {
        repliesSkipped += 1;
      } else {
        hadUnexpectedFailure = true;
      }
    }

    // The watermark moves **after** the replies are written, and not at all if
    // something failed for a reason that might not recur. Saving it first and
    // then failing would skip a supplier's reply permanently — the one failure
    // this feature cannot recover from on its own.
    if (hadUnexpectedFailure) {
      await this.connectionService.recordSyncFailure(
        connection,
        'Some replies could not be read; they will be retried on the next pass',
      );
    } else {
      await this.connectionService.recordSync(connection, page.cursor);
    }

    if (repliesRead > 0) {
      this.logger.log(
        `Read ${repliesRead} supplier repl${repliesRead === 1 ? 'y' : 'ies'} for store ${connection.storeId}`,
      );
    }

    return {
      storeId: connection.storeId,
      threadsWatched: threadIds.length,
      repliesRead,
      repliesSkipped,
      wasCursorReset: page.wasCursorReset,
    };
  }

  /**
   * One reply into one offer, through the same seam the paste route uses.
   *
   * A `BadRequestException` or `NotFoundException` here is a **deliberate** skip
   * rather than a failure: the request was confirmed or cancelled between the
   * send and the reply, and a supplier answering a closed request has done
   * nothing wrong. Anything else is unexpected, and holds the watermark back so
   * the reply is retried instead of lost.
   */
  private async applyReply(
    store: Store,
    offer: SupplierOffer,
    reply: InboundReply,
  ): Promise<'read' | 'skipped' | 'failed'> {
    if (reply.fromEmail !== offer.supplierEmail) {
      // Not refused: a supplier's colleague answering from their own address is
      // still an answer, and the adapter has already excluded our own sent mail.
      // Worth a line in the log, because it is also what a forwarded thread
      // looks like.
      this.logger.debug(
        `Reply on offer ${offer.id} came from ${reply.fromEmail}, not ${offer.supplierEmail}`,
      );
    }

    try {
      const { wasIngested } = await this.replyService.ingest({
        store,
        offerId: offer.id,
        body: reply.body,
        providerMessageId: reply.providerMessageId,
        receivedAt: reply.receivedAt,
      });
      return wasIngested ? 'read' : 'skipped';
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        this.logger.debug(
          `Skipping a reply on offer ${offer.id}: ${err.message}`,
        );
        return 'skipped';
      }

      this.logger.warn(
        `Could not read a reply on offer ${offer.id}: ${String(err)}`,
      );
      return 'failed';
    }
  }

  /**
   * The offers worth watching: still awaiting or already received, on a request
   * that is `sent` or `replied`, and carrying a thread id.
   *
   * `received` is included as well as `awaiting` because a supplier can revise a
   * quote — the second email is the one that counts, and an offer that stopped
   * being watched the moment it was answered would never see it.
   */
  private async findOpenThreadOffers(
    storeId: string,
  ): Promise<SupplierOffer[]> {
    return this.offerRepository.find({
      where: {
        storeId,
        mailboxThreadId: Not(IsNull()),
        status: In([
          SupplierOfferStatus.Awaiting,
          SupplierOfferStatus.Received,
        ]),
        purchaseRequest: {
          status: In([
            PurchaseRequestStatus.Sent,
            PurchaseRequestStatus.Replied,
          ]),
        },
      },
      relations: { purchaseRequest: true },
    });
  }

  /** The store, for its currency — which is what the extraction is read in. */
  private async loadStore(
    connection: MailboxConnection,
  ): Promise<Store | null> {
    const withStore = await this.connectionRepository.findOne({
      where: { id: connection.id },
      relations: { store: true },
    });
    return withStore?.store ?? null;
  }
}
