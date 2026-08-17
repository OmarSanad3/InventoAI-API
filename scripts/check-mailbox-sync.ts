/**
 * Verifies the mailbox sync orchestration without a Google account.
 *
 * The Gmail round trip cannot be exercised without a real Cloud client and a
 * browser consent, so `MAILBOX_PROVIDER` — **and only it** — is replaced by a
 * fake that answers from a script. Everything underneath is the real thing: the
 * connection service and its AES-256-GCM storage, the dedupe rule,
 * `SupplierReplyService.ingest`, the offer extraction, the request status machine,
 * and the database with its partial unique index.
 *
 * That is the same division the Google Sign-In branch used when it stubbed
 * `GoogleTokenVerifier` and left every account rule real, and for the same
 * reason: the part that cannot be tested locally is the part Google owns.
 *
 * Run against a seeded development database:
 *
 *     npx ts-node --files -P tsconfig.json scripts/check-mailbox-sync.ts
 *
 * It creates its own store fixture rows, and deletes them again, so a seeded
 * database ends where it started.
 */
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Store } from '../src/site-builder/entities/store.entity';
import { StoreStatus } from '../src/site-builder/enums/store-status.enum';
import { MailboxConnection } from '../src/suppliers/entities/mailbox-connection.entity';
import { PurchaseRequest } from '../src/suppliers/entities/purchase-request.entity';
import { SupplierOffer } from '../src/suppliers/entities/supplier-offer.entity';
import { MailboxConnectionStatus } from '../src/suppliers/enums/mailbox-connection-status.enum';
import { OfferExtractionStatus } from '../src/suppliers/enums/offer-extraction-status.enum';
import { PurchaseRequestStatus } from '../src/suppliers/enums/purchase-request-status.enum';
import { SupplierOfferStatus } from '../src/suppliers/enums/supplier-offer-status.enum';
import { MailboxSyncService } from '../src/suppliers/mailbox-sync.service';
import {
  MAILBOX_PROVIDER,
  MailboxGrantRevokedError,
  MailboxProviderName,
  type InboundReply,
  type MailboxProvider,
  type ReplyPage,
  type ReplyQuery,
} from '../src/suppliers/mailbox/mailbox.provider';
import { encryptSecret } from '../src/suppliers/utils/secret-cipher.util';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`  ok   ${label}`);
    return;
  }
  failed += 1;
  console.log(
    `  FAIL ${label}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`,
  );
}

/** A mailbox that answers from a script. Records what it was asked for. */
class FakeMailboxProvider implements MailboxProvider {
  readonly name = MailboxProviderName.Gmail;

  nextPage: ReplyPage = { replies: [], cursor: null, wasCursorReset: false };
  throwRevoked = false;
  lastQuery: ReplyQuery | null = null;
  callCount = 0;

  isConfigured(): boolean {
    return true;
  }

  buildConsentUrl(): string {
    return 'https://accounts.google.test/consent';
  }

  exchangeCode(): Promise<never> {
    throw new Error('not used by this check');
  }

  sendEmail(): Promise<never> {
    throw new Error('not used by this check');
  }

  readCurrentCursor(): Promise<string | null> {
    return Promise.resolve('cursor-now');
  }

  fetchReplies(query: ReplyQuery): Promise<ReplyPage> {
    this.callCount += 1;
    this.lastQuery = query;
    if (this.throwRevoked) {
      throw new MailboxGrantRevokedError('invalid_grant (fake)');
    }
    return Promise.resolve(this.nextPage);
  }
}

function buildReply(overrides: Partial<InboundReply> = {}): InboundReply {
  return {
    providerMessageId: `msg-${randomUUID()}`,
    threadId: 'thread-1',
    fromEmail: 'sales@niletextiles.test',
    receivedAt: new Date(),
    body: 'We can supply at 235 EGP each, delivery takes two weeks. 15 available.',
    ...overrides,
  };
}

async function main(): Promise<void> {
  const fake = new FakeMailboxProvider();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILBOX_PROVIDER)
    .useValue(fake)
    .compile();

  const app = moduleRef.createNestApplication({ logger: ['error'] });
  await app.init();

  const dataSource = app.get(DataSource);
  const config = app.get(ConfigService);
  const syncService = app.get(MailboxSyncService);

  const stores = dataSource.getRepository(Store);
  const connections = dataSource.getRepository(MailboxConnection);
  const requests = dataSource.getRepository(PurchaseRequest);
  const offers = dataSource.getRepository(SupplierOffer);

  const store = await stores.findOne({ where: { status: StoreStatus.Live } });
  if (!store) {
    throw new Error('No live store — run `npm run seed -- --force` first');
  }

  const keyHex = config.get<string>('MAILBOX_TOKEN_ENCRYPTION_KEY') ?? '';
  if (!keyHex) {
    throw new Error('MAILBOX_TOKEN_ENCRYPTION_KEY must be set for this check');
  }

  // --- fixture: a sent request with one thread-carrying offer -----------------
  const request = await requests.save(
    requests.create({
      storeId: store.id,
      productTitle: 'Check Fixture Abaya',
      variantLabel: null,
      quantity: 18,
      neededWithinDays: 10,
      subject: 'Purchase request — check fixture',
      body: 'Could you quote 18 units?',
      status: PurchaseRequestStatus.Sent,
      sentAt: new Date(),
    }),
  );

  const offer = await offers.save(
    offers.create({
      storeId: store.id,
      purchaseRequestId: request.id,
      supplierName: 'Nile Textiles',
      supplierEmail: 'sales@niletextiles.test',
      status: SupplierOfferStatus.Awaiting,
      sentAt: new Date(),
      mailboxThreadId: 'thread-1',
    }),
  );

  const connection = await connections.save(
    connections.create({
      storeId: store.id,
      provider: MailboxProviderName.Gmail,
      accountEmail: 'owner@layali.test',
      refreshTokenCipher: encryptSecret({
        plaintext: 'fake-refresh-token',
        keyHex,
      }),
      scopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
      ],
      syncCursor: 'cursor-1',
      status: MailboxConnectionStatus.Connected,
      connectedAt: new Date(),
    }),
  );

  const reload = async (): Promise<SupplierOffer> => {
    const fresh = await offers.findOne({ where: { id: offer.id } });
    if (!fresh) throw new Error('offer vanished');
    return fresh;
  };
  const reloadConnection = async (): Promise<MailboxConnection> => {
    const fresh = await connections.findOne({ where: { id: connection.id } });
    if (!fresh) throw new Error('connection vanished');
    return fresh;
  };

  try {
    // --- 1. a reply is read, and only for the threads we opened ---------------
    console.log('\nReading a reply');
    const firstReply = buildReply({ providerMessageId: 'msg-1' });
    fake.nextPage = {
      replies: [
        firstReply,
        // A message in some other thread of the owner's mailbox: it must be
        // ignored, because it belongs to no offer of ours.
        buildReply({ providerMessageId: 'msg-stranger', threadId: 'thread-x' }),
      ],
      cursor: 'cursor-2',
      wasCursorReset: false,
    };

    const first = await syncService.syncStore(connection);
    check('only our thread was asked for', fake.lastQuery?.threadIds, [
      'thread-1',
    ]);
    check('the stored cursor was sent', fake.lastQuery?.cursor, 'cursor-1');
    check('one reply read', first?.repliesRead, 1);
    check('threads watched', first?.threadsWatched, 1);

    const afterFirst = await reload();
    check('offer is now received', afterFirst.status, 'received');
    check('raw reply stored', afterFirst.rawReply, firstReply.body);
    check('message id recorded', afterFirst.mailboxMessageId, 'msg-1');
    // The extraction is a live Gemini call, so it can legitimately be
    // unavailable. When it ran, the conversions are asserted exactly; when it did
    // not, that is reported rather than counted as a pass.
    if (afterFirst.extractionStatus === OfferExtractionStatus.Parsed) {
      check('235 EGP became 23500 minor units', afterFirst.unitAmount, 23500);
      check('"two weeks" became 14 days', afterFirst.deliveryDays, 14);
      check('the offered quantity was read', afterFirst.quantity, 15);
    } else {
      console.log(
        `  skip extraction unavailable (${afterFirst.extractionStatus}) — rawReply is still stored`,
      );
      check(
        'a failed extraction still kept the reply',
        afterFirst.rawReply,
        firstReply.body,
      );
    }

    const requestAfterFirst = await requests.findOneByOrFail({
      id: request.id,
    });
    check('request flipped to replied', requestAfterFirst.status, 'replied');
    check(
      'cursor advanced after the commit',
      (await reloadConnection()).syncCursor,
      'cursor-2',
    );

    // --- 2. the same message again changes nothing ----------------------------
    console.log('\nReplaying the same message');
    const before = await reload();
    fake.nextPage = {
      replies: [firstReply],
      cursor: 'cursor-3',
      wasCursorReset: false,
    };

    const second = await syncService.syncStore(connection);
    check('nothing read', second?.repliesRead, 0);
    check('one skipped', second?.repliesSkipped, 1);

    const afterReplay = await reload();
    check(
      'the offer was not touched',
      afterReplay.updatedAt.getTime(),
      before.updatedAt.getTime(),
    );

    // --- 3. an expired watermark re-reads, and the older quote is not applied --
    console.log('\nAn expired watermark re-reads the thread');
    const stored = await reload();
    fake.nextPage = {
      replies: [
        buildReply({
          providerMessageId: 'msg-0-older',
          receivedAt: new Date(stored.repliedAt!.getTime() - 60_000),
          body: 'Our first quote was 400 EGP each, 30 days.',
        }),
      ],
      cursor: 'cursor-4',
      wasCursorReset: true,
    };

    const third = await syncService.syncStore(connection);
    check('the older message was skipped', third?.repliesSkipped, 1);
    check('cursor reset was reported', third?.wasCursorReset, true);

    const afterReset = await reload();
    check(
      'the newer quote survived the re-read',
      afterReset.rawReply,
      stored.rawReply,
    );
    check('message id unchanged', afterReset.mailboxMessageId, 'msg-1');

    // --- 4. a revoked grant stops the polling --------------------------------
    console.log('\nA revoked grant');
    fake.throwRevoked = true;
    const fourth = await syncService.syncStore(connection);
    check('no outcome', fourth, null);

    const revoked = await reloadConnection();
    check('marked revoked', revoked.status, 'revoked');
    check(
      'the reason is on the row for the dashboard',
      revoked.lastError !== null && revoked.lastError.includes('reconnect'),
      true,
    );
    fake.throwRevoked = false;

    // --- 5. a closed request is not polled ----------------------------------
    console.log('\nA confirmed request is no longer watched');
    await connections.update(
      { id: connection.id },
      { status: MailboxConnectionStatus.Connected, lastError: null },
    );
    await requests.update(
      { id: request.id },
      { status: PurchaseRequestStatus.Confirmed },
    );

    const callsBefore = fake.callCount;
    const fifth = await syncService.syncStore(
      await connections.findOneByOrFail({ id: connection.id }),
    );
    check('no outcome for a closed request', fifth, null);
    check('the mailbox was not called at all', fake.callCount, callsBefore);
  } finally {
    await offers.delete({ purchaseRequestId: request.id });
    await requests.delete({ id: request.id });
    await connections.delete({ id: connection.id });
    await app.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
