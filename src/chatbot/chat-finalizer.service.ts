import { Injectable } from '@nestjs/common';
import { ProductPublicListItemDto } from '../catalog/dto/product-public-list-item.dto';
import { PublicProductService } from '../catalog/public-product.service';
import { FaqService } from '../faq/faq.service';
import { OrderListItemDto } from '../orders/dto/order-list-item.dto';
import { CustomerOrderService } from '../orders/customer-order.service';
import {
  CHATBOT_FAQ_CITATION_LIMIT,
  CHATBOT_PRODUCT_CARD_LIMIT,
} from './chatbot.constants';
import { FaqCitationDto } from './dto/chat-reply.dto';
import { ChatResolution } from './enums/chat-resolution.enum';
import { ChatTurnContext, ChatTurnSources } from './types/chat-turn';
import { resolveOutcome } from './utils/resolve-outcome.util';

export interface FinalizedTurn {
  readonly resolution: ChatResolution;
  readonly products: ProductPublicListItemDto[];
  readonly faqs: FaqCitationDto[];
  readonly order: OrderListItemDto | null;
}

/**
 * The deterministic half of a turn: what the shopper is *shown*, and what the
 * exchange is recorded as.
 *
 * Both are computed from what the tools actually returned, never from what the
 * model said about itself. A model asked whether it was helpful says yes, and
 * `Unanswered` is the column the Advisor mines to tell an owner what to stock.
 *
 * The payload is rebuilt from ids against live rows for the same reason: a price
 * the model typed into its sentence is not a price the storefront renders.
 */
@Injectable()
export class ChatFinalizer {
  constructor(
    private readonly publicProductService: PublicProductService,
    private readonly faqService: FaqService,
    private readonly customerOrderService: CustomerOrderService,
  ) {}

  async finalize(
    context: ChatTurnContext,
    sources: ChatTurnSources,
    { hasFailed }: { hasFailed: boolean },
  ): Promise<FinalizedTurn> {
    const resolution = resolveOutcome(sources, hasFailed);
    if (resolution === ChatResolution.Error) {
      return { resolution, products: [], faqs: [], order: null };
    }

    const [products, faqs, order] = await Promise.all([
      this.loadProducts(context, sources),
      this.loadFaqs(context, sources),
      this.loadOrder(context, sources),
    ]);

    return { resolution, products, faqs, order };
  }

  private async loadProducts(
    context: ChatTurnContext,
    sources: ChatTurnSources,
  ): Promise<ProductPublicListItemDto[]> {
    const products = await this.publicProductService.loadCardsByIds(
      context.store.id,
      sources.productIds.slice(0, CHATBOT_PRODUCT_CARD_LIMIT),
    );
    return products.map((product) =>
      ProductPublicListItemDto.fromEntity(product),
    );
  }

  private async loadFaqs(
    context: ChatTurnContext,
    sources: ChatTurnSources,
  ): Promise<FaqCitationDto[]> {
    const entries = await this.faqService.findPublishedByIds(
      context.store.id,
      sources.faqIds.slice(0, CHATBOT_FAQ_CITATION_LIMIT),
    );
    return entries.map((entry) => ({ id: entry.id, question: entry.question }));
  }

  private async loadOrder(
    context: ChatTurnContext,
    sources: ChatTurnSources,
  ): Promise<OrderListItemDto | null> {
    if (!context.user || sources.orderNumber === null) {
      return null;
    }

    const order = await this.customerOrderService
      .getMine(context.user, context.slug, sources.orderNumber)
      .catch(() => null);
    return order ? OrderListItemDto.fromEntity(order) : null;
  }
}
