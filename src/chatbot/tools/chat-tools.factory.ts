import { Injectable, Logger } from '@nestjs/common';
import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { PublicProductService } from '../../catalog/public-product.service';
import { Product } from '../../catalog/entities/product.entity';
import { ProductVariant } from '../../catalog/entities/product-variant.entity';
import { FaqService } from '../../faq/faq.service';
import { KnowledgeSourceType } from '../../knowledge/enums/knowledge-source-type.enum';
import { RetrievalService } from '../../knowledge/retrieval.service';
import { CustomerOrderService } from '../../orders/customer-order.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  CHATBOT_ORDER_LIST_LIMIT,
  CHATBOT_TOOL_RESULT_LIMIT,
} from '../chatbot.constants';
import { ChatTurnContext, ChatTurnSources } from '../types/chat-turn';

/**
 * The stock band the storefront's product detail already returns. The chatbot
 * must not become the endpoint that leaks exact inventory, so it gets the same
 * banding rather than the number.
 */
const LOW_STOCK_BAND = 5;

/**
 * Builds the tool set for **one turn**.
 *
 * Every tool is a thin wrapper over a service that already exists and is already
 * tested through its own endpoints, so a rule cannot drift between chat and the
 * storefront — a facet that works on `/site/:slug/products` works here by
 * construction.
 *
 * Two properties hold for all of them:
 *
 * - **No tool takes a `storeId` or a `userId`.** They are closed over from
 *   `context`, which came from the URL slug and the verified token.
 * - **The order tools are absent, not refused, when nobody is signed in.** A
 *   tool that does not exist cannot be called, so there is no path from an
 *   anonymous session to an order row — not a refusal the model could be talked
 *   out of. What it gets instead is `order_lookup_requires_sign_in`, which
 *   reaches no data and only records that this was an order question.
 */
@Injectable()
export class ChatToolsFactory {
  private readonly logger = new Logger(ChatToolsFactory.name);

  constructor(
    private readonly retrieval: RetrievalService,
    private readonly publicProductService: PublicProductService,
    private readonly faqService: FaqService,
    private readonly customerOrderService: CustomerOrderService,
  ) {}

  build(
    context: ChatTurnContext,
    sources: ChatTurnSources,
  ): StructuredToolInterface[] {
    const tools = [
      this.buildSearchProducts(context, sources),
      this.buildGetProductDetails(context, sources),
      this.buildCheckAvailability(context, sources),
      this.buildSearchFaq(context, sources),
      this.buildGetStoreInfo(context, sources),
    ];

    if (context.user) {
      tools.push(
        this.buildListMyOrders(context, sources),
        this.buildGetMyOrder(context, sources),
      );
    } else {
      tools.push(this.buildSignInRequired(sources));
    }
    return tools;
  }

  /**
   * The anonymous stand-in for the two order tools. It reaches no data and
   * cannot: it exists so that "where is my order" from a signed-out visitor is
   * **routed** rather than guessed at.
   *
   * The alternative was a keyword check on the message, which would have to
   * enumerate the ways to say "order" in English and Arabic and would still miss
   * the third phrasing. Letting the model route and the code decide is the same
   * division of labour the rest of the tool set uses.
   */
  private buildSignInRequired(
    sources: ChatTurnSources,
  ): StructuredToolInterface {
    return tool(
      () => {
        sources.callCount += 1;
        sources.needsSignIn = true;
        return JSON.stringify({
          signedIn: false,
          instruction:
            'Tell the customer to sign in to see their order, in one short sentence. Do not ask them for any personal details.',
        });
      },
      {
        name: 'order_lookup_requires_sign_in',
        description:
          'Call this whenever the customer asks about an order, a delivery, a shipment or a refund of something they bought. They are not signed in, so no order can be looked up.',
        schema: z.object({}),
      },
    );
  }

  private buildSearchProducts(
    context: ChatTurnContext,
    sources: ChatTurnSources,
  ): StructuredToolInterface {
    return tool(
      async ({ query }: { query: string }) => {
        sources.callCount += 1;

        const hits = await this.retrieval.search({
          storeId: context.store.id,
          query,
          sourceTypes: [KnowledgeSourceType.Product],
          limit: CHATBOT_TOOL_RESULT_LIMIT,
        });

        // Hits are pointers: the live rows are loaded here, with the storefront
        // predicates applied again, so an index a minute behind cannot put an
        // archived product in front of a shopper.
        const products = await this.publicProductService.loadCardsByIds(
          context.store.id,
          hits.map((hit) => hit.sourceId),
        );
        this.remember(sources, products);

        return JSON.stringify({
          currency: context.store.currency,
          products: products.map((product) => summarizeProduct(product)),
        });
      },
      {
        name: 'search_products',
        description:
          "Search this store's catalog by meaning or by name. Use it for any question about what the store sells, including vague ones like 'a gift for a five-year-old'.",
        schema: z.object({
          query: z
            .string()
            .describe('What the customer is looking for, in their own words'),
        }),
      },
    );
  }

  private buildGetProductDetails(
    context: ChatTurnContext,
    sources: ChatTurnSources,
  ): StructuredToolInterface {
    return tool(
      async ({ productSlug }: { productSlug: string }) => {
        sources.callCount += 1;

        const product = await this.publicProductService
          .getBySlug(context.slug, productSlug)
          .catch(() => null);
        if (!product) {
          return JSON.stringify({ found: false });
        }
        this.remember(sources, [product]);

        return JSON.stringify({
          found: true,
          currency: context.store.currency,
          ...summarizeProduct(product),
          description: product.description,
          variants: (product.variants ?? []).map((variant) => ({
            options: describeOptions(variant),
            priceAmount: variant.priceAmount,
            availability: describeStock(variant.stockQuantity),
          })),
        });
      },
      {
        name: 'get_product_details',
        description:
          'Look up one product by its slug, for its full description, its options and their prices. Get the slug from search_products first.',
        schema: z.object({
          productSlug: z.string().describe('The product slug, e.g. blue-mug'),
        }),
      },
    );
  }

  private buildCheckAvailability(
    context: ChatTurnContext,
    sources: ChatTurnSources,
  ): StructuredToolInterface {
    return tool(
      async ({ productSlug }: { productSlug: string }) => {
        sources.callCount += 1;

        const product = await this.publicProductService
          .getBySlug(context.slug, productSlug)
          .catch(() => null);
        if (!product) {
          return JSON.stringify({ found: false });
        }
        this.remember(sources, [product]);

        return JSON.stringify({
          found: true,
          inStock: product.totalStock > 0,
          options: (product.variants ?? []).map((variant) => ({
            options: describeOptions(variant),
            availability: describeStock(variant.stockQuantity),
          })),
        });
      },
      {
        name: 'check_availability',
        description:
          'Check whether a product, and each of its size/colour combinations, is still in stock.',
        schema: z.object({
          productSlug: z.string().describe('The product slug'),
        }),
      },
    );
  }

  private buildSearchFaq(
    context: ChatTurnContext,
    sources: ChatTurnSources,
  ): StructuredToolInterface {
    return tool(
      async ({ query }: { query: string }) => {
        sources.callCount += 1;

        const hits = await this.retrieval.search({
          storeId: context.store.id,
          query,
          sourceTypes: [KnowledgeSourceType.Faq],
        });
        const entries = await this.faqService.findPublishedByIds(
          context.store.id,
          hits.map((hit) => hit.sourceId),
        );
        if (entries.length > 0) {
          sources.hitCount += 1;
          sources.faqIds.push(...entries.map((entry) => entry.id));
        }

        return JSON.stringify({
          entries: entries.map((entry) => ({
            question: entry.question,
            answer: entry.answer,
          })),
        });
      },
      {
        name: 'search_faq',
        description:
          "Search the store's published policies and FAQ — delivery, returns, payment, sizing. Use it for any question about how the store operates.",
        schema: z.object({
          query: z
            .string()
            .describe('The policy question, in the customer’s words'),
        }),
      },
    );
  }

  private buildGetStoreInfo(
    context: ChatTurnContext,
    sources: ChatTurnSources,
  ): StructuredToolInterface {
    return tool(
      async () => {
        sources.callCount += 1;

        const hits = await this.retrieval.search({
          storeId: context.store.id,
          query: context.store.name,
          sourceTypes: [KnowledgeSourceType.StoreProfile],
          limit: 1,
        });
        sources.hitCount += 1;

        return JSON.stringify({
          name: context.store.name,
          currency: context.store.currency,
          about: hits[0]?.content ?? context.store.description ?? null,
        });
      },
      {
        name: 'get_store_info',
        description:
          'What this store is and what it sells. Use it for "who are you", "what do you sell", and questions about the shop itself.',
        schema: z.object({}),
      },
    );
  }

  private buildListMyOrders(
    context: ChatTurnContext,
    sources: ChatTurnSources,
  ): StructuredToolInterface {
    return tool(
      async () => {
        sources.callCount += 1;

        const query = new PaginationQueryDto();
        query.page = 1;
        query.limit = CHATBOT_ORDER_LIST_LIMIT;

        const [orders] = await this.customerOrderService.listMine(
          context.user!,
          context.slug,
          query,
        );
        if (orders.length > 0) {
          sources.hitCount += 1;
          sources.orderId = orders[0].id;
          sources.orderNumber = orders[0].orderNumber;
        }

        return JSON.stringify({
          currency: context.store.currency,
          orders: orders.map((order) => ({
            orderNumber: order.orderNumber,
            status: order.status,
            paymentStatus: order.paymentStatus,
            totalAmount: order.totalAmount,
            placedAt: order.createdAt,
          })),
        });
      },
      {
        name: 'list_my_orders',
        description:
          "The signed-in customer's own recent orders, newest first. Use it for 'where is my order' when they did not give a number.",
        schema: z.object({}),
      },
    );
  }

  private buildGetMyOrder(
    context: ChatTurnContext,
    sources: ChatTurnSources,
  ): StructuredToolInterface {
    return tool(
      async ({ orderNumber }: { orderNumber: number }) => {
        sources.callCount += 1;

        const order = await this.customerOrderService
          .getMine(context.user!, context.slug, orderNumber)
          .catch(() => null);
        if (!order) {
          return JSON.stringify({ found: false });
        }
        sources.hitCount += 1;
        sources.orderId = order.id;
        sources.orderNumber = order.orderNumber;

        return JSON.stringify({
          found: true,
          currency: order.currency,
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          totalAmount: order.totalAmount,
          placedAt: order.createdAt,
          // Snapshots, as stored at purchase time — never re-fetched.
          items: (order.items ?? []).map((item) => ({
            title: item.productTitle,
            quantity: item.quantity,
            unitAmount: item.unitAmount,
            options: item.variantOptions,
          })),
        });
      },
      {
        name: 'get_my_order',
        description:
          "Look up one of the signed-in customer's own orders by its number.",
        schema: z.object({
          orderNumber: z
            .number()
            .int()
            .describe('The order number from their confirmation, e.g. 1042'),
        }),
      },
    );
  }

  private remember(
    sources: ChatTurnSources,
    products: readonly Product[],
  ): void {
    if (products.length === 0) {
      return;
    }
    sources.hitCount += 1;
    for (const product of products) {
      if (!sources.productIds.includes(product.id)) {
        sources.productIds.push(product.id);
      }
    }
  }
}

/**
 * What a tool hands the model: enough to compose a sentence, and no more. The
 * card the storefront renders is built in `finalize` from the ids, not from
 * anything the model echoed back — so a price it types is never the price shown.
 */
function summarizeProduct(product: Product): Record<string, unknown> {
  return {
    title: product.title,
    slug: product.slug,
    summary: product.shortDescription,
    minPriceAmount: product.minPriceAmount,
    maxPriceAmount: product.maxPriceAmount,
    inStock: product.totalStock > 0,
    categories: (product.categories ?? [])
      .filter((category) => category.isPublished)
      .map((category) => category.name),
  };
}

function describeOptions(variant: ProductVariant): Record<string, string> {
  const options: Record<string, string> = {};
  for (const value of variant.attributeValues ?? []) {
    if (value.attribute?.name) {
      options[value.attribute.name] = value.value;
    }
  }
  return options;
}

/** Bands, never the number — the same rule the storefront's detail page follows. */
function describeStock(stockQuantity: number): string {
  if (stockQuantity <= 0) {
    return 'out of stock';
  }
  return stockQuantity <= LOW_STOCK_BAND ? 'only a few left' : 'in stock';
}
