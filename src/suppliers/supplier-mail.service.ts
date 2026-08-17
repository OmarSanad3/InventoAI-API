import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import type { SupplierDecision } from '../mail/templates/supplier-decision-email.template';
import {
  buildSupplierDecisionEmail,
  buildSupplierDecisionSubject,
} from '../mail/templates/supplier-decision-email.template';
import { buildSupplierRequestEmail } from '../mail/templates/supplier-request-email.template';
import { Store } from '../site-builder/entities/store.entity';
import { User } from '../users/entities/user.entity';
import { MailboxConnectionStatus } from './enums/mailbox-connection-status.enum';
import { MailboxConnectionService } from './mailbox-connection.service';
import {
  MAILBOX_PROVIDER,
  MailboxGrantRevokedError,
  type MailboxGrant,
  type MailboxProvider,
  type OutboundEmail,
} from './mailbox/mailbox.provider';
import { MINOR_UNITS_PER_MAJOR } from './suppliers.constants';
import { SupplierOffer } from './entities/supplier-offer.entity';
import { PurchaseRequest } from './entities/purchase-request.entity';
import { describeItem } from './utils/fallback-request-email.util';

/** What a send produced: the thread to watch, when there is one. */
export interface SupplierMailReceipt {
  readonly threadId: string | null;
  readonly providerMessageId: string | null;
}

/**
 * Turns a request or a decision into the email of it, and chooses which mailbox
 * it leaves from.
 *
 * A service of its own rather than code inside `PurchaseRequestService`, for the
 * reason `AdvisorMailService` exists: two things about supplier mail are
 * decisions rather than parameters. The **brand** is the store's own, because a
 * supplier is dealing with Layali and not with InventoAI; and the **return path**
 * is the owner, because the platform's mailbox is not one anybody reads.
 *
 * There are now two transports, and the choice between them is not a
 * preference — it decides whether replies can be read back:
 *
 * - **The owner's connected mailbox**, when there is one. The message is sent as
 *   them, so the supplier's reply lands in their inbox, in a thread whose id we
 *   captured. That id is what makes ingestion a primary-key lookup.
 * - **SMTP**, otherwise, exactly as before. The supplier still replies to the
 *   owner — via `Reply-To` — but nothing can watch for it, so those replies
 *   arrive by paste. Every store that has connected nothing is in this case, and
 *   it is a supported one rather than a degraded one.
 *
 * A mailbox send that fails **falls back to SMTP** rather than failing the
 * request. Losing the ability to read a reply automatically costs a paste; not
 * sending the email at all costs the deal.
 */
@Injectable()
export class SupplierMailService {
  private readonly logger = new Logger(SupplierMailService.name);

  constructor(
    private readonly mailService: MailService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly connectionService: MailboxConnectionService,
    @Inject(MAILBOX_PROVIDER)
    private readonly mailboxProvider: MailboxProvider,
  ) {}

  async sendRequest({
    store,
    request,
    offer,
  }: {
    store: Store;
    request: PurchaseRequest;
    offer: SupplierOffer;
  }): Promise<SupplierMailReceipt> {
    const replyToEmail = await this.resolveReplyTo(store);
    const brand = this.buildBrand(store);

    const grant = await this.resolveGrant(store);
    if (grant) {
      const { html, text } = buildSupplierRequestEmail({
        brand,
        supplierName: offer.supplierName,
        body: request.body,
        replyToEmail,
      });

      const receipt = await this.sendThroughMailbox(store, grant, {
        from: { name: store.name, email: grant.accountEmail },
        to: { name: offer.supplierName, email: offer.supplierEmail },
        // Deliberately no Reply-To: the mailbox we send from is the mailbox we
        // poll, and a Reply-To pointing at some *other* address of the owner's
        // would route the reply somewhere this feature cannot see it.
        replyToEmail: null,
        subject: request.subject,
        text,
        html,
      });

      if (receipt) {
        return receipt;
      }
    }

    await this.mailService.sendSupplierRequest({
      to: offer.supplierEmail,
      brand,
      supplierName: offer.supplierName,
      subject: request.subject,
      body: request.body,
      replyToEmail,
    });

    return { threadId: null, providerMessageId: null };
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
    const replyToEmail = await this.resolveReplyTo(store);
    const brand = this.buildBrand(store);
    const itemLabel = describeItem(request.productTitle, request.variantLabel);
    const terms =
      outcome === 'confirmed' ? buildTerms(request, offer, store.currency) : [];

    const grant = await this.resolveGrant(store);
    if (grant) {
      const { html, text } = buildSupplierDecisionEmail({
        brand,
        supplierName: offer.supplierName,
        outcome,
        itemLabel,
        terms,
        replyToEmail,
      });

      const receipt = await this.sendThroughMailbox(store, grant, {
        from: { name: store.name, email: grant.accountEmail },
        to: { name: offer.supplierName, email: offer.supplierEmail },
        replyToEmail: null,
        subject: buildSupplierDecisionSubject({
          outcome,
          itemLabel,
          brandName: brand.name,
        }),
        text,
        html,
      });

      if (receipt) {
        return;
      }
    }

    await this.mailService.sendSupplierDecision({
      to: offer.supplierEmail,
      brand,
      supplierName: offer.supplierName,
      outcome,
      itemLabel,
      terms,
      replyToEmail,
    });
  }

  /**
   * Returns `null` when the mailbox could not take it, which is the caller's
   * signal to use SMTP. A revoked grant is recorded on the way past: the owner
   * finds out from the dashboard rather than from replies quietly stopping.
   */
  private async sendThroughMailbox(
    store: Store,
    grant: MailboxGrant,
    email: OutboundEmail,
  ): Promise<SupplierMailReceipt | null> {
    try {
      const sent = await this.mailboxProvider.sendEmail({ grant, email });
      return {
        threadId: sent.threadId,
        providerMessageId: sent.providerMessageId,
      };
    } catch (err) {
      if (err instanceof MailboxGrantRevokedError) {
        const connection = await this.connectionService.findForStore(store.id);
        if (connection) {
          await this.connectionService.markRevoked(connection, err);
        }
      }
      this.logger.warn(
        `Could not send through ${store.slug}'s mailbox, falling back to SMTP: ${String(err)}`,
      );
      return null;
    }
  }

  /** The store's mailbox grant, or `null` if it has none this server can use. */
  private async resolveGrant(store: Store): Promise<MailboxGrant | null> {
    if (!this.connectionService.isSupported()) {
      return null;
    }

    const connection = await this.connectionService.findForStore(store.id);
    if (
      !connection ||
      connection.status !== MailboxConnectionStatus.Connected
    ) {
      return null;
    }

    return this.connectionService.resolveGrant(connection);
  }

  private buildBrand(store: Store): { name: string; logoUrl: string | null } {
    return { name: store.name, logoUrl: store.logoUrl };
  }

  /**
   * The owner's own address. A supplier replies to a person, not to a platform
   * mailbox — and the owner is who has to read it.
   *
   * Used by the SMTP path and by the branded footer of both templates. It is
   * *not* used as a `Reply-To` on the mailbox path, for the reason given above.
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
