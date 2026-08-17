import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeminiService } from '../ai/gemini.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { Store } from '../site-builder/entities/store.entity';
import { StoreService } from '../site-builder/store.service';
import { SubmitReplyDto } from './dto/submit-reply.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { PurchaseRequest } from './entities/purchase-request.entity';
import { SupplierOffer } from './entities/supplier-offer.entity';
import { OfferExtractionStatus } from './enums/offer-extraction-status.enum';
import { PurchaseRequestStatus } from './enums/purchase-request-status.enum';
import { SupplierOfferStatus } from './enums/supplier-offer-status.enum';
import {
  buildExtractOfferPrompt,
  buildExtractOfferSchema,
} from './prompts/extract-offer.prompt';
import { PurchaseRequestService } from './purchase-request.service';
import { OFFER_EXTRACTION_TEMPERATURE } from './suppliers.constants';
import { isReplyAlreadyRead } from './utils/reply-dedupe.util';
import {
  hasAnyField,
  sanitizeExtractedOffer,
  type ExtractedOffer,
} from './utils/sanitize-offer.util';

/**
 * Reads a supplier's reply and turns it into three numbers.
 *
 * **`ingest` is the seam, and it now has two callers.** The owner's paste route
 * was the first; `MailboxSyncService` is the second, and it was the whole reason
 * the transport was left out of phase 1 rather than half-built into it. The
 * method takes a store and an offer id — never a `JwtPayload` — precisely so a
 * cron with no caller can use it.
 *
 * The raw reply is stored **before** the model is called. A parse failure costs
 * an owner three fields they can type themselves; it never costs the reply.
 *
 * **A machine's caller must be idempotent where a human's need not be.** A
 * person pastes once and means it; a sync re-delivers a history page, and an
 * expired watermark makes every known thread be re-read from the beginning. So
 * an inbound message carries its provider id and `ingest` refuses to read the
 * same one twice — without which a replay would re-run Gemini over a price the
 * owner may since have corrected by hand.
 */
@Injectable()
export class SupplierReplyService {
  private readonly logger = new Logger(SupplierReplyService.name);

  constructor(
    @InjectRepository(SupplierOffer)
    private readonly offerRepository: Repository<SupplierOffer>,
    private readonly storeService: StoreService,
    private readonly purchaseRequestService: PurchaseRequestService,
    private readonly geminiService: GeminiService,
  ) {}

  /** The owner's paste. Resolves their store, then goes through the same seam. */
  async ingestFromPaste(
    user: JwtPayload,
    requestId: string,
    offerId: string,
    dto: SubmitReplyDto,
  ): Promise<PurchaseRequest> {
    const store = await this.storeService.resolveCallerStore(user);
    // Loaded here as well as inside `ingest`, because a paste addresses an offer
    // *through* a request id and a mismatch between the two must 404 rather than
    // quietly writing to the offer the id alone points at.
    const request = await this.purchaseRequestService.loadFull(
      store.id,
      requestId,
    );
    this.findOffer(request, offerId);

    await this.ingest({ store, offerId, body: dto.body });

    // The whole request comes back, not the one row: a new price re-ranks every
    // other offer, and a client given only its own row would draw a stale
    // table.
    return this.purchaseRequestService.loadFull(store.id, requestId);
  }

  /**
   * The seam: one reply, read into one offer.
   *
   * `wasIngested: false` means the message had already been read — a normal
   * outcome for a sync and not an error. The caller advances its watermark either
   * way, because a message it has decided to skip is a message it has processed.
   */
  async ingest({
    store,
    offerId,
    body,
    providerMessageId = null,
    receivedAt = null,
  }: {
    store: Store;
    offerId: string;
    body: string;
    /** The mail provider's message id, for callers that can replay. */
    providerMessageId?: string | null;
    receivedAt?: Date | null;
  }): Promise<{ offer: SupplierOffer; wasIngested: boolean }> {
    const offer = await this.loadOffer(store.id, offerId);
    const request = await this.purchaseRequestService.loadFull(
      store.id,
      offer.purchaseRequestId,
    );
    assertCanReceiveReplies(request);

    if (isReplyAlreadyRead(offer, { providerMessageId, receivedAt })) {
      return { offer, wasIngested: false };
    }

    // Stored first, and on its own: whatever the model does next, the reply is
    // in the row and the owner can read it.
    const trimmed = body.trim();
    offer.rawReply = trimmed;
    offer.repliedAt = receivedAt ?? new Date();
    offer.status = SupplierOfferStatus.Received;
    offer.mailboxMessageId = providerMessageId ?? offer.mailboxMessageId;
    await this.offerRepository.save(offer);

    const extracted = await this.extract(request, store.currency, trimmed);
    if (extracted && hasAnyField(extracted)) {
      offer.unitAmount = extracted.unitAmount;
      offer.quantity = extracted.quantity;
      offer.deliveryDays = extracted.deliveryDays;
      offer.notes = extracted.notes;
      offer.extractionStatus = OfferExtractionStatus.Parsed;
    } else {
      offer.extractionStatus = OfferExtractionStatus.Failed;
    }
    await this.offerRepository.save(offer);

    await this.purchaseRequestService.markReplied(request);

    return { offer, wasIngested: true };
  }

  /**
   * The owner's own correction, and the reason a failed extraction is not a
   * dead end. It is also how a model that read "250 for 100 pieces, 350 for
   * fewer" and picked the wrong one gets fixed — which it will.
   */
  async updateOffer(
    user: JwtPayload,
    requestId: string,
    offerId: string,
    dto: UpdateOfferDto,
  ): Promise<PurchaseRequest> {
    const store = await this.storeService.resolveCallerStore(user);
    const request = await this.purchaseRequestService.loadFull(
      store.id,
      requestId,
    );
    const offer = this.findOffer(request, offerId);

    if (
      request.status === PurchaseRequestStatus.Confirmed ||
      request.status === PurchaseRequestStatus.Cancelled
    ) {
      throw new ConflictException(
        `An offer cannot be edited once the request is ${request.status}`,
      );
    }

    if (dto.unitAmount !== undefined) {
      offer.unitAmount = dto.unitAmount;
    }
    if (dto.quantity !== undefined) {
      offer.quantity = dto.quantity;
    }
    if (dto.deliveryDays !== undefined) {
      offer.deliveryDays = dto.deliveryDays;
    }
    if (dto.notes !== undefined) {
      offer.notes = dto.notes?.trim() || null;
    }

    // The numbers are the owner's now, whoever read them first.
    offer.extractionStatus = OfferExtractionStatus.Manual;
    if (offer.status === SupplierOfferStatus.Awaiting) {
      offer.status = SupplierOfferStatus.Received;
      offer.repliedAt ??= new Date();
    }
    await this.offerRepository.save(offer);

    await this.purchaseRequestService.markReplied(request);

    return this.purchaseRequestService.loadFull(store.id, requestId);
  }

  /** A Gemini outage is a `failed` extraction, never a lost reply. */
  private async extract(
    request: PurchaseRequest,
    currency: string,
    body: string,
  ): Promise<ExtractedOffer | null> {
    try {
      const response = await this.geminiService.generateJson<unknown>({
        prompt: buildExtractOfferPrompt({
          currency,
          productTitle: request.productTitle,
          quantityAsked: request.quantity,
          replyBody: body,
        }),
        schema: buildExtractOfferSchema(),
        temperature: OFFER_EXTRACTION_TEMPERATURE,
      });

      return sanitizeExtractedOffer(response);
    } catch (error) {
      this.logger.warn(
        `Could not read the reply on offer of request ${request.id}: ${String(error)}`,
      );
      return null;
    }
  }

  private findOffer(request: PurchaseRequest, offerId: string): SupplierOffer {
    const offer = request.offers.find((candidate) => candidate.id === offerId);
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    return offer;
  }

  /** Scoped by store, so an offer of another store looks missing. */
  private async loadOffer(
    storeId: string,
    offerId: string,
  ): Promise<SupplierOffer> {
    const offer = await this.offerRepository.findOne({
      where: { id: offerId, storeId },
    });
    if (!offer) {
      throw new NotFoundException('Offer not found');
    }
    return offer;
  }
}

/** A reply to a request nobody has sent is not a reply to anything. */
function assertCanReceiveReplies(request: PurchaseRequest): void {
  if (
    request.status !== PurchaseRequestStatus.Sent &&
    request.status !== PurchaseRequestStatus.Replied
  ) {
    throw new BadRequestException(
      `A reply can only be recorded on a request that has been sent; this one is ${request.status}`,
    );
  }
}
