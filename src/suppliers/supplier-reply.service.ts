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
import {
  hasAnyField,
  sanitizeExtractedOffer,
  type ExtractedOffer,
} from './utils/sanitize-offer.util';

/**
 * Reads a supplier's reply and turns it into three numbers.
 *
 * **`ingest` is the seam.** Today its only caller is the paste route: the owner
 * forwards what the supplier wrote and the model reads it. Automatic ingestion
 * — an IMAP poller or a provider webhook — is a second caller of this method
 * and nothing else, which is the whole reason the transport was left out of
 * this branch rather than half-built into it.
 *
 * The raw reply is stored **before** the model is called. A parse failure costs
 * an owner three fields they can type themselves; it never costs the reply.
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

  async ingest(
    user: JwtPayload,
    requestId: string,
    offerId: string,
    dto: SubmitReplyDto,
  ): Promise<PurchaseRequest> {
    const store = await this.storeService.resolveCallerStore(user);
    const request = await this.purchaseRequestService.loadFull(
      store.id,
      requestId,
    );
    const offer = this.findOffer(request, offerId);
    assertCanReceiveReplies(request);

    // Stored first, and on its own: whatever the model does next, the reply is
    // in the row and the owner can read it.
    const body = dto.body.trim();
    offer.rawReply = body;
    offer.repliedAt = new Date();
    offer.status = SupplierOfferStatus.Received;
    await this.offerRepository.save(offer);

    const extracted = await this.extract(request, store.currency, body);
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

    // The whole request comes back, not the one row: a new price re-ranks every
    // other offer, and a client given only its own row would draw a stale
    // table.
    return this.purchaseRequestService.loadFull(store.id, requestId);
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
