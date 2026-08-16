import { DataSource } from 'typeorm';
import { ProductVariant } from '../../src/catalog/entities/product-variant.entity';
import { ProductService } from '../../src/catalog/product.service';
import { findPrimaryImage } from '../../src/catalog/utils/primary-image.util';
import { OrderItem } from '../../src/orders/entities/order-item.entity';
import { Order } from '../../src/orders/entities/order.entity';
import { OrderStatus } from '../../src/orders/enums/order-status.enum';
import { PaymentMethod } from '../../src/orders/enums/payment-method.enum';
import { PaymentStatus } from '../../src/orders/enums/payment-status.enum';
import { buildVariantOptions } from '../../src/orders/utils/variant-snapshot.util';
import { Store } from '../../src/site-builder/entities/store.entity';
import { SeededStore } from './seed-stores';

/** One seeded order, kept so the report can print its number and id. */
export interface SeededOrder {
  readonly storeSlug: string;
  readonly order: Order;
}

/** A line, addressed by the variant's seeded SKU. */
interface SeedOrderLine {
  readonly sku: string;
  readonly quantity: number;
}

interface SeedOrder {
  readonly storeSlug: string;
  /** Which seeded account bought it. */
  readonly buyerEmail: string;
  readonly status: OrderStatus;
  readonly paymentStatus: PaymentStatus;
  readonly lines: readonly SeedOrderLine[];
  /**
   * How many days back the order was placed.
   *
   * Every seeded order used to be dated *now*, which made the Daily AI
   * Advisor's 7-day window a comparison against 28 days of nothing — every
   * product in the store came back "trending", and none of it was testable.
   * Spreading them across the last two months is what makes a velocity mean
   * something.
   */
  readonly daysAgo: number;
  readonly customerNote?: string;
  readonly internalNote?: string;
  readonly cancelReason?: string;
}

const SHIPPING_ADDRESS = {
  line1: '18 Talaat Harb St',
  line2: 'Apartment 5',
  city: 'Cairo',
  governorate: 'Cairo',
  postalCode: '11511',
  country: 'EG',
} as const;

const ALEXANDRIA_ADDRESS = {
  line1: '7 Corniche Rd',
  line2: null,
  city: 'Alexandria',
  governorate: 'Alexandria',
  postalCode: null,
  country: 'EG',
} as const;

/**
 * One order per interesting state, so the dashboard has something in every
 * column of its status filter and the storefront's history page is not empty.
 *
 * `draftco` gets none: a draft store cannot take orders, which is the case the
 * storefront's 404 needs to stay reachable.
 */
const SEED_ORDERS: readonly SeedOrder[] = [
  {
    storeSlug: 'layali',
    buyerEmail: 'shopper.layali@inventoai.test',
    status: OrderStatus.Delivered,
    paymentStatus: PaymentStatus.Paid,
    daysAgo: 46,
    lines: [
      { sku: 'ABA-CRP-M-BLK', quantity: 1 },
      { sku: 'ACC-PIN-12', quantity: 2 },
    ],
    internalNote: 'Regular customer — packed with a sample of the new crepe.',
  },
  {
    storeSlug: 'layali',
    buyerEmail: 'shopper.layali@inventoai.test',
    status: OrderStatus.Shipped,
    paymentStatus: PaymentStatus.Unpaid,
    daysAgo: 31,
    lines: [{ sku: 'HIJ-CHF-IVO', quantity: 3 }],
    customerNote: 'Please gift wrap.',
  },
  {
    storeSlug: 'layali',
    buyerEmail: 'shopper.layali@inventoai.test',
    status: OrderStatus.Confirmed,
    paymentStatus: PaymentStatus.Unpaid,
    daysAgo: 12,
    lines: [{ sku: 'KAF-SLK-M-IVO', quantity: 1 }],
  },
  {
    storeSlug: 'layali',
    buyerEmail: 'shopper.layali@inventoai.test',
    status: OrderStatus.Pending,
    paymentStatus: PaymentStatus.Unpaid,
    daysAgo: 2,
    lines: [
      { sku: 'ABA-LIN-M-SND', quantity: 1 },
      { sku: 'ACC-CAP-BLK', quantity: 1 },
    ],
    customerNote: 'Call before delivery, the doorbell is broken.',
  },
  {
    // Cancelled orders never held stock in the seed: a cancel restores it, so
    // the net effect on the catalog's numbers is zero either way.
    storeSlug: 'layali',
    buyerEmail: 'shopper.layali@inventoai.test',
    status: OrderStatus.Cancelled,
    paymentStatus: PaymentStatus.Unpaid,
    daysAgo: 21,
    lines: [{ sku: 'ABA-CRP-S-NVY', quantity: 1 }],
    cancelReason: 'Ordered the wrong size',
  },
  {
    storeSlug: 'fokhar',
    buyerEmail: 'shopper.fokhar@inventoai.test',
    status: OrderStatus.Pending,
    paymentStatus: PaymentStatus.Unpaid,
    daysAgo: 3,
    lines: [{ sku: 'MUG-FAY-M-TER', quantity: 4 }],
    customerNote: 'For a wedding, they must match.',
  },
  {
    storeSlug: 'fokhar',
    buyerEmail: 'shopper.fokhar@inventoai.test',
    status: OrderStatus.Delivered,
    paymentStatus: PaymentStatus.Paid,
    daysAgo: 41,
    lines: [{ sku: 'GFT-MUG-2', quantity: 1 }],
  },

  /*
   * The orders below exist for the Daily AI Advisor, so every insight kind is
   * reachable from a fresh seed instead of only after a store has traded for a
   * month. They are ordinary orders in every other respect.
   *
   * `slow_mover` needs no fixture at all: several seeded products hold stock
   * and have never been ordered, which is exactly the case it looks for.
   */

  // trending — a burst inside the 7-day window against a quiet baseline.
  {
    storeSlug: 'layali',
    buyerEmail: 'shopper.layali@inventoai.test',
    status: OrderStatus.Delivered,
    paymentStatus: PaymentStatus.Paid,
    daysAgo: 33,
    lines: [{ sku: 'HIJ-CHF-BLK', quantity: 2 }],
  },
  {
    storeSlug: 'layali',
    buyerEmail: 'shopper.layali@inventoai.test',
    status: OrderStatus.Delivered,
    paymentStatus: PaymentStatus.Paid,
    daysAgo: 5,
    lines: [{ sku: 'HIJ-CHF-BLK', quantity: 5 }],
  },
  {
    storeSlug: 'layali',
    buyerEmail: 'shopper.layali@inventoai.test',
    status: OrderStatus.Shipped,
    paymentStatus: PaymentStatus.Unpaid,
    daysAgo: 1,
    lines: [{ sku: 'HIJ-CHF-BLK', quantity: 7 }],
  },

  // stockout — the sand hijab sells its last four this week and ends on zero.
  {
    storeSlug: 'layali',
    buyerEmail: 'shopper.layali@inventoai.test',
    status: OrderStatus.Confirmed,
    paymentStatus: PaymentStatus.Unpaid,
    daysAgo: 4,
    lines: [{ sku: 'HIJ-CHF-SND', quantity: 4 }],
    internalNote: 'Cleared the last of the sand chiffon.',
  },

  // restock — steady demand against a shelf that will not survive the lead time.
  {
    storeSlug: 'layali',
    buyerEmail: 'shopper.layali@inventoai.test',
    status: OrderStatus.Delivered,
    paymentStatus: PaymentStatus.Paid,
    daysAgo: 6,
    lines: [{ sku: 'ABA-CRP-M-NVY', quantity: 3 }],
  },
  {
    storeSlug: 'layali',
    buyerEmail: 'shopper.layali@inventoai.test',
    status: OrderStatus.Confirmed,
    paymentStatus: PaymentStatus.Unpaid,
    daysAgo: 2,
    lines: [{ sku: 'ABA-CRP-M-NVY', quantity: 3 }],
  },

  // fokhar gets its own recent movement, so its brief is not a copy of layali's.
  {
    storeSlug: 'fokhar',
    buyerEmail: 'shopper.fokhar@inventoai.test',
    status: OrderStatus.Delivered,
    paymentStatus: PaymentStatus.Paid,
    daysAgo: 4,
    lines: [{ sku: 'MUG-FAY-M-TER', quantity: 6 }],
  },
];

/**
 * Orders for the seeded stores, snapshotted exactly the way checkout does it —
 * title, slug, primary image, SKU, unit price and the option labels — because a
 * seeded order that renders differently from a placed one is worse than none.
 *
 * Stock is decremented for every order that is not cancelled, and the products'
 * aggregates go back through `ProductService.recalculateAggregates`, which is
 * the single writer of the four derived columns.
 */
export async function seedOrders(
  dataSource: DataSource,
  productService: ProductService,
  stores: readonly SeededStore[],
): Promise<SeededOrder[]> {
  const seeded: SeededOrder[] = [];

  for (const { store, definition, accounts } of stores) {
    const fixtures = SEED_ORDERS.filter(
      (fixture) => fixture.storeSlug === definition.slug,
    );
    if (fixtures.length === 0) {
      continue;
    }

    const variants = await loadVariantsBySku(dataSource, store.id);
    let orderNumber = 1;

    for (const fixture of fixtures) {
      const buyer = accounts.find(
        (account) => account.user.email === fixture.buyerEmail,
      );
      if (!buyer) {
        throw new Error(`seed: no account ${fixture.buyerEmail}`);
      }

      const order = await writeOrder({
        dataSource,
        productService,
        store,
        fixture,
        orderNumber,
        buyer: buyer.user,
        variants,
      });
      orderNumber += 1;
      seeded.push({ storeSlug: definition.slug, order });
    }

    store.nextOrderNumber = orderNumber;
    await dataSource.getRepository(Store).save(store);
  }

  return seeded;
}

async function writeOrder({
  dataSource,
  productService,
  store,
  fixture,
  orderNumber,
  buyer,
  variants,
}: {
  dataSource: DataSource;
  productService: ProductService;
  store: Store;
  fixture: SeedOrder;
  orderNumber: number;
  buyer: { id: string; firstName: string; lastName: string; email: string };
  variants: ReadonlyMap<string, ProductVariant>;
}): Promise<Order> {
  const lines = fixture.lines.map((line) => {
    const variant = variants.get(line.sku);
    if (!variant) {
      throw new Error(`seed: no variant with sku ${line.sku}`);
    }
    return { line, variant };
  });

  const subtotalAmount = lines.reduce(
    (sum, { line, variant }) => sum + variant.priceAmount * line.quantity,
    0,
  );
  const isCancelled = fixture.status === OrderStatus.Cancelled;
  const placedAt = daysAgo(fixture.daysAgo);

  return dataSource.transaction(async (manager) => {
    const order = manager.create(Order, {
      storeId: store.id,
      orderNumber,
      userId: buyer.id,
      contactName: `${buyer.firstName} ${buyer.lastName}`,
      contactEmail: buyer.email,
      contactPhone: '+201001234567',
      shippingAddress:
        store.slug === 'fokhar' ? ALEXANDRIA_ADDRESS : SHIPPING_ADDRESS,
      status: fixture.status,
      paymentStatus: fixture.paymentStatus,
      paymentMethod: PaymentMethod.Cod,
      currency: store.currency,
      subtotalAmount,
      shippingFee: 0,
      totalAmount: subtotalAmount,
      customerNote: fixture.customerNote ?? null,
      internalNote: fixture.internalNote ?? null,
      cancelledAt: isCancelled ? placedAt : null,
      cancelReason: fixture.cancelReason ?? null,
    });
    await manager.save(order);

    // `createdAt` is a `@CreateDateColumn`, so TypeORM writes "now" on insert
    // whatever the fixture assigns — the back-dating has to be its own
    // statement, after the row exists. Do not "simplify" this into the object
    // above: it silently stops working and every seeded order lands on today,
    // which is precisely the state that made the Advisor untestable.
    await manager.query('UPDATE orders SET "createdAt" = $1 WHERE id = $2', [
      placedAt,
      order.id,
    ]);
    order.createdAt = placedAt;

    const items = lines.map(({ line, variant }, index) =>
      manager.create(OrderItem, {
        orderId: order.id,
        productId: variant.productId,
        variantId: variant.id,
        productTitle: variant.product.title,
        productSlug: variant.product.slug,
        productImageUrl: findPrimaryImage(variant.product.images)?.url ?? null,
        variantOptions: buildVariantOptions(variant.attributeValues),
        sku: variant.sku,
        unitAmount: variant.priceAmount,
        quantity: line.quantity,
        lineTotalAmount: variant.priceAmount * line.quantity,
        position: index,
      }),
    );
    await manager.save(items);

    if (isCancelled) {
      return order;
    }

    for (const { line, variant } of lines) {
      // Checkout's conditional update makes negative stock impossible on the
      // real path; the seed writes straight through the repository, so the
      // same invariant needs saying out loud here. Without it a fixture that
      // orders one of a sold-out variant leaves `-1` in the catalog, and every
      // number derived from it — the aggregates, the Advisor's coverage — is
      // quietly wrong.
      if (variant.stockQuantity < line.quantity) {
        throw new Error(
          `seed: order for ${line.quantity} of ${line.sku} would leave ` +
            `${variant.stockQuantity - line.quantity} in stock`,
        );
      }

      await manager.decrement(
        ProductVariant,
        { id: variant.id },
        'stockQuantity',
        line.quantity,
      );
      variant.stockQuantity -= line.quantity;
    }
    for (const productId of new Set(
      lines.map(({ variant }) => variant.productId),
    )) {
      await productService.recalculateAggregates(productId, manager);
    }

    return order;
  });
}

/** Every SKU of one store, with what an order line has to snapshot. */
async function loadVariantsBySku(
  dataSource: DataSource,
  storeId: string,
): Promise<Map<string, ProductVariant>> {
  const variants = await dataSource
    .getRepository(ProductVariant)
    .createQueryBuilder('variant')
    .innerJoinAndSelect('variant.product', 'product')
    .leftJoinAndSelect('product.images', 'image')
    .leftJoinAndSelect('variant.attributeValues', 'value')
    .leftJoinAndSelect('value.attribute', 'attribute')
    .where('variant.storeId = :storeId', { storeId })
    .andWhere('variant.sku IS NOT NULL')
    .getMany();

  return new Map(
    variants
      .filter((variant): variant is ProductVariant & { sku: string } =>
        Boolean(variant.sku),
      )
      .map((variant) => [variant.sku, variant]),
  );
}

/** `days` before now, for a fixture that wants to be a month old. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
