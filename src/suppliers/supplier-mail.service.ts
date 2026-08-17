import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import type { SupplierDecision } from '../mail/templates/supplier-decision-email.template';
import { Store } from '../site-builder/entities/store.entity';
import { User } from '../users/entities/user.entity';
import { MINOR_UNITS_PER_MAJOR } from './suppliers.constants';
import { SupplierOffer } from './entities/supplier-offer.entity';
import { PurchaseRequest } from './entities/purchase-request.entity';
import { describeItem } from './utils/fallback-request-email.util';

/**
 * Turns a request or a decision into the email of it.
 *
 * A service of its own rather than code inside `PurchaseRequestService`, for
 * the reason `AdvisorMailService` exists: two things about supplier mail are
 * decisions rather than parameters. The **brand** is the store's own, because a
 * supplier is dealing with Layali and not with InventoAI; and the **reply-to**
 * is the owner's address, because the platform's mailbox is not one anybody
 * reads. Until inbound ingestion exists, that reply-to is the whole return
 * path.
 */
@Injectable()
export class SupplierMailService {
  constructor(
    private readonly mailService: MailService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async sendRequest({
    store,
    request,
    offer,
  }: {
    store: Store;
    request: PurchaseRequest;
    offer: SupplierOffer;
  }): Promise<void> {
    await this.mailService.sendSupplierRequest({
      to: offer.supplierEmail,
      brand: this.buildBrand(store),
      supplierName: offer.supplierName,
      subject: request.subject,
      body: request.body,
      replyToEmail: await this.resolveReplyTo(store),
    });
  }

  async sendDecision({
    store,
    request,
    offer,
    outcome,
  }: {
    store: Store;
    request: PurchaseRequest;
    offer: SupplierOffer;
    outcome: SupplierDecision;
  }): Promise<void> {
    await this.mailService.sendSupplierDecision({
      to: offer.supplierEmail,
      brand: this.buildBrand(store),
      supplierName: offer.supplierName,
      outcome,
      itemLabel: describeItem(request.productTitle, request.variantLabel),
      terms:
        outcome === 'confirmed'
          ? buildTerms(request, offer, store.currency)
          : [],
      replyToEmail: await this.resolveReplyTo(store),
    });
  }

  private buildBrand(store: Store): { name: string; logoUrl: string | null } {
    return { name: store.name, logoUrl: store.logoUrl };
  }

  /**
   * The owner's own address. A supplier replies to a person, not to a platform
   * mailbox — and the owner is who has to read it.
   */
  private async resolveReplyTo(store: Store): Promise<string> {
    const owner = await this.userRepository.findOne({
      where: { id: store.ownerId },
      select: { id: true, email: true },
    });
    return owner?.email ?? '';
  }
}

/**
 * The agreed terms, spelled out in the confirmation so both sides are holding
 * the same three numbers.
 *
 * **Money is formatted here**, before it leaves the codebase: every amount in
 * this project is an integer of minor units, and a supplier reading "24900 EGP"
 * for a 249-pound item is the same hundredfold error the Advisor's narrator
 * made — only this time it is in writing to somebody outside the company.
 */
function buildTerms(
  request: PurchaseRequest,
  offer: SupplierOffer,
  currency: string,
): string[] {
  const terms: string[] = [];

  if (offer.unitAmount !== null) {
    terms.push(`Unit price: ${formatMoney(offer.unitAmount, currency)}`);
  }

  const quantity = offer.quantity ?? request.quantity;
  terms.push(`Quantity: ${quantity}`);

  if (offer.unitAmount !== null) {
    terms.push(`Total: ${formatMoney(offer.unitAmount * quantity, currency)}`);
  }
  if (offer.deliveryDays !== null) {
    terms.push(
      `Delivery: ${offer.deliveryDays === 1 ? '1 day' : `${offer.deliveryDays} days`}`,
    );
  }

  return terms;
}

function formatMoney(amount: number, currency: string): string {
  const major = amount / MINOR_UNITS_PER_MAJOR;
  const formatted = major.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${currency}`;
}
