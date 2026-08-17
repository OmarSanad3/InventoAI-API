import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ProductService } from '../catalog/product.service';
import { Store } from '../site-builder/entities/store.entity';
import { StoreService } from '../site-builder/store.service';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { ListPurchaseRequestsQueryDto } from './dto/list-purchase-requests-query.dto';
import { UpdatePurchaseRequestDto } from './dto/update-purchase-request.dto';
import { PurchaseRequest } from './entities/purchase-request.entity';
import { Supplier } from './entities/supplier.entity';
import { SupplierOffer } from './entities/supplier-offer.entity';
import { PurchaseRequestStatus } from './enums/purchase-request-status.enum';
import { SupplierOfferStatus } from './enums/supplier-offer-status.enum';
import { SupplierDraftService } from './supplier-draft.service';
import { SupplierMailService } from './supplier-mail.service';
import { SupplierService } from './supplier.service';
import { assertRequestTransition } from './utils/request-transition.util';

/**
 * Owns the `PurchaseRequest` row and **is the only writer of its status** — the
 * same rule `OrderService.changeStatus` follows, and for the same reason: send,
 * the first reply, cancel and confirm are four callers of one machine, and a
 * second writer is how a cancelled request gets confirmed.
 *
 * Mail is always sent **after** the row is written, never inside the
 * transaction: a decline that bounces is a logged warning, not a rolled-back
 * deal. The owner's decision is recorded either way, and a mail can be re-sent
 * where a lost decision cannot be recovered.
 */
@Injectable()
export class PurchaseRequestService {
  private readonly logger = new Logger(PurchaseRequestService.name);

  constructor(
    @InjectRepository(PurchaseRequest)
    private readonly requestRepository: Repository<PurchaseRequest>,
    @InjectRepository(SupplierOffer)
    private readonly offerRepository: Repository<SupplierOffer>,
    private readonly storeService: StoreService,
    private readonly supplierService: SupplierService,
    private readonly productService: ProductService,
    private readonly draftService: SupplierDraftService,
    private readonly supplierMailService: SupplierMailService,
  ) {}

  /**
   * Drafts a request and lists its recipients as `awaiting` offers. **Nothing
   * is emailed** — an agent that mails suppliers on its own is a purchase
   * nobody approved, so the owner reviews the draft and presses send.
   */
  async create(
    user: JwtPayload,
    dto: CreatePurchaseRequestDto,
  ): Promise<PurchaseRequest> {
    const store = await this.storeService.resolveCallerStore(user);

    const level = await this.productService.findStockLevel(
      store.id,
      dto.variantId,
    );
    if (!level) {
      throw new NotFoundException('Product variant not found');
    }

    const suppliers = await this.resolveRecipients(store.id, dto.supplierIds);
    const draft = await this.draftService.draft({
      storeName: store.name,
      locale: store.locale,
      storeDescription: store.description,
      productTitle: level.productTitle,
      variantLabel: level.variantLabel,
      quantity: dto.quantity,
      neededWithinDays: dto.neededWithinDays ?? null,
      note: dto.note?.trim() || null,
    });

    const request = await this.requestRepository.manager.transaction(
      async (manager) => {
        const saved = await manager.save(
          manager.create(PurchaseRequest, {
            storeId: store.id,
            productId: level.productId,
            variantId: level.variantId,
            productTitle: level.productTitle,
            variantLabel: level.variantLabel,
            quantity: dto.quantity,
            neededWithinDays: dto.neededWithinDays ?? null,
            subject: draft.subject,
            body: draft.body,
            note: dto.note?.trim() || null,
            status: PurchaseRequestStatus.Draft,
            draftStatus: draft.draftStatus,
          }),
        );

        await manager.save(
          suppliers.map((supplier) =>
            manager.create(SupplierOffer, buildOffer(saved, supplier)),
          ),
        );

        return saved;
      },
    );

    return this.loadFull(store.id, request.id);
  }

  async list(
    user: JwtPayload,
    query: ListPurchaseRequestsQueryDto,
  ): Promise<{ items: PurchaseRequest[]; total: number }> {
    const store = await this.storeService.resolveCallerStore(user);

    const [items, total] = await this.requestRepository.findAndCount({
      where: {
        storeId: store.id,
        ...(query.status ? { status: query.status } : {}),
      },
      relations: { offers: true },
      order: { createdAt: 'DESC' },
      skip: query.offset,
      take: query.limit,
    });

    return { items, total };
  }

  async getById(user: JwtPayload, id: string): Promise<PurchaseRequest> {
    const store = await this.storeService.resolveCallerStore(user);
    return this.loadFull(store.id, id);
  }

  /**
   * Editable while it is a draft, and not after: the suppliers have already
   * read the old text, and a request whose body changed under them is a request
   * whose offers are answers to a different question.
   */
  async update(
    user: JwtPayload,
    id: string,
    dto: UpdatePurchaseRequestDto,
  ): Promise<PurchaseRequest> {
    const store = await this.storeService.resolveCallerStore(user);
    const request = await this.loadFull(store.id, id);

    if (request.status !== PurchaseRequestStatus.Draft) {
      throw new ConflictException(
        `A purchase request can only be edited while it is a draft; this one is ${request.status}`,
      );
    }

    if (dto.subject !== undefined) {
      request.subject = dto.subject.trim();
    }
    if (dto.body !== undefined) {
      request.body = dto.body.trim();
    }
    if (dto.quantity !== undefined) {
      request.quantity = dto.quantity;
    }
    if (dto.neededWithinDays !== undefined) {
      request.neededWithinDays = dto.neededWithinDays;
    }
    if (dto.note !== undefined) {
      request.note = dto.note?.trim() || null;
    }

    const suppliers =
      dto.supplierIds === undefined
        ? null
        : await this.resolveRecipients(store.id, dto.supplierIds);

    await this.requestRepository.manager.transaction(async (manager) => {
      await manager.save(request);

      if (suppliers) {
        // Nothing has been mailed yet, so replacing the recipient list is a
        // delete and an insert rather than a reconciliation.
        await manager.delete(SupplierOffer, { purchaseRequestId: request.id });
        await manager.save(
          suppliers.map((supplier) =>
            manager.create(SupplierOffer, buildOffer(request, supplier)),
          ),
        );
      }
    });

    return this.loadFull(store.id, id);
  }

  /**
   * Mails every recipient who has never been mailed, and only them.
   *
   * That is what makes this idempotent: a second press re-tries the suppliers a
   * failed send left behind and bothers nobody who already has the email. A
   * request that reached at least one supplier is `sent`; one that reached
   * nobody stays a draft, so the owner can fix the address and try again.
   */
  async send(user: JwtPayload, id: string): Promise<PurchaseRequest> {
    const store = await this.storeService.resolveCallerStore(user);
    const request = await this.loadFull(store.id, id);

    if (
      request.status !== PurchaseRequestStatus.Draft &&
      request.status !== PurchaseRequestStatus.Sent
    ) {
      assertRequestTransition({
        from: request.status,
        to: PurchaseRequestStatus.Sent,
      });
    }

    const pending = request.offers.filter((offer) => offer.sentAt === null);
    if (pending.length === 0) {
      throw new BadRequestException(
        'Every supplier on this request has already been emailed',
      );
    }

    const sent = await this.mailRecipients(store, request, pending);
    if (sent.length === 0) {
      throw new ServiceUnavailableException(
        'The request could not be emailed to any supplier, please try again',
      );
    }

    if (request.status === PurchaseRequestStatus.Draft) {
      assertRequestTransition({
        from: request.status,
        to: PurchaseRequestStatus.Sent,
      });
      request.status = PurchaseRequestStatus.Sent;
      request.sentAt = new Date();
      await this.requestRepository.save(request);
    }

    return this.loadFull(store.id, id);
  }

  async cancel(user: JwtPayload, id: string): Promise<PurchaseRequest> {
    const store = await this.storeService.resolveCallerStore(user);
    const request = await this.loadFull(store.id, id);

    assertRequestTransition({
      from: request.status,
      to: PurchaseRequestStatus.Cancelled,
    });
    request.status = PurchaseRequestStatus.Cancelled;
    await this.requestRepository.save(request);

    return this.loadFull(store.id, id);
  }

  /**
   * The deal: one offer wins, every other one is declined, and both emails go
   * out.
   *
   * The write is conditional on the status this call read, so two owners
   * confirming different offers at once produce one deal and one 409 — the same
   * reasoning as the stock reservation in checkout, where the loser's `UPDATE`
   * affecting zero rows is what makes the race safe.
   */
  async confirm(
    user: JwtPayload,
    id: string,
    offerId: string,
  ): Promise<PurchaseRequest> {
    const store = await this.storeService.resolveCallerStore(user);
    const request = await this.loadFull(store.id, id);

    const winner = request.offers.find((offer) => offer.id === offerId);
    if (!winner) {
      throw new NotFoundException('Offer not found');
    }
    if (winner.unitAmount === null) {
      throw new BadRequestException(
        'This offer has no price yet — ask the supplier for one, or enter it yourself',
      );
    }
    assertRequestTransition({
      from: request.status,
      to: PurchaseRequestStatus.Confirmed,
    });

    const decidedAt = new Date();
    const losers = request.offers.filter((offer) => offer.id !== winner.id);

    await this.requestRepository.manager.transaction(async (manager) => {
      const result = await manager.update(
        PurchaseRequest,
        { id: request.id, storeId: store.id, status: request.status },
        {
          status: PurchaseRequestStatus.Confirmed,
          confirmedAt: decidedAt,
          confirmedOfferId: winner.id,
        },
      );
      if (result.affected === 0) {
        throw new ConflictException(
          'This purchase request was updated by someone else, please reload it',
        );
      }

      await manager.update(
        SupplierOffer,
        { id: winner.id },
        { status: SupplierOfferStatus.Won, decidedAt },
      );

      if (losers.length > 0) {
        await manager.update(
          SupplierOffer,
          { id: In(losers.map((offer) => offer.id)) },
          { status: SupplierOfferStatus.Declined, decidedAt },
        );
      }
    });

    await this.mailDecisions(store, request, winner, losers);

    return this.loadFull(store.id, id);
  }

  /**
   * The first reply moves the request on. Called by `SupplierReplyService`
   * rather than written there, so the machine keeps its single writer.
   *
   * A reply to a request that is already `replied` is not a transition at all,
   * which is why this is a no-op rather than a 400 — the second supplier to
   * answer has done nothing wrong.
   */
  async markReplied(request: PurchaseRequest): Promise<void> {
    if (request.status !== PurchaseRequestStatus.Sent) {
      return;
    }
    assertRequestTransition({
      from: request.status,
      to: PurchaseRequestStatus.Replied,
    });
    request.status = PurchaseRequestStatus.Replied;
    await this.requestRepository.save(request);
  }

  /** The request with its offers, oldest first. A request of another store must
   *  look missing, never forbidden. */
  async loadFull(storeId: string, id: string): Promise<PurchaseRequest> {
    const request = await this.requestRepository.findOne({
      where: { id, storeId },
      relations: { offers: true },
    });
    if (!request) {
      throw new NotFoundException('Purchase request not found');
    }
    request.offers.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    return request;
  }

  /**
   * Every id must be a live, active supplier of this store. A missing one is a
   * 400 rather than a silent short recipient list: an owner who picked four
   * suppliers and had three mailed would never find out which.
   */
  private async resolveRecipients(
    storeId: string,
    supplierIds: readonly string[],
  ): Promise<Supplier[]> {
    const unique = [...new Set(supplierIds)];
    const suppliers = await this.supplierService.findActiveByIds(
      storeId,
      unique,
    );
    if (suppliers.length !== unique.length) {
      throw new BadRequestException(
        'Every supplier must belong to your store and be active',
      );
    }
    return suppliers;
  }

  /** Mails what it can and reports what it managed — one bad address must not
   *  cost the other five suppliers their email. */
  private async mailRecipients(
    store: Store,
    request: PurchaseRequest,
    offers: readonly SupplierOffer[],
  ): Promise<SupplierOffer[]> {
    const results = await Promise.allSettled(
      offers.map((offer) =>
        this.supplierMailService.sendRequest({ store, request, offer }),
      ),
    );

    const sent: SupplierOffer[] = [];
    const sentAt = new Date();

    for (const [index, result] of results.entries()) {
      const offer = offers[index];
      if (result.status === 'rejected') {
        this.logger.warn(
          `Could not email ${offer.supplierEmail} for request ${request.id}: ${String(result.reason)}`,
        );
        continue;
      }
      offer.sentAt = sentAt;
      sent.push(offer);
    }

    if (sent.length > 0) {
      await this.offerRepository.save(sent);
    }
    return sent;
  }

  /** The confirmation and the declines. Failures are logged: the deal is
   *  already written, and a mail is re-sendable where a decision is not. */
  private async mailDecisions(
    store: Store,
    request: PurchaseRequest,
    winner: SupplierOffer,
    losers: readonly SupplierOffer[],
  ): Promise<void> {
    const results = await Promise.allSettled([
      this.supplierMailService.sendDecision({
        store,
        request,
        offer: winner,
        outcome: 'confirmed',
      }),
      // A supplier who never answered is told too — silence is not a decline,
      // and they may be holding stock for this. One who was never *emailed*
      // is not: they would be declined for a request they never received.
      ...losers
        .filter((offer) => offer.sentAt !== null)
        .map((offer) =>
          this.supplierMailService.sendDecision({
            store,
            request,
            offer,
            outcome: 'declined',
          }),
        ),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Could not email a decision for request ${request.id}: ${String(result.reason)}`,
        );
      }
    }
  }
}

/** The recipient row: a supplier who has been asked, with the snapshot that
 *  survives their deletion. */
function buildOffer(
  request: PurchaseRequest,
  supplier: Supplier,
): Partial<SupplierOffer> {
  return {
    storeId: request.storeId,
    purchaseRequestId: request.id,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierEmail: supplier.contactEmail,
    status: SupplierOfferStatus.Awaiting,
  };
}
