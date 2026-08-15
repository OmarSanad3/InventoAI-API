import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ProductVariant } from '../catalog/entities/product-variant.entity';
import { ProductStatus } from '../catalog/enums/product-status.enum';
import { ProductService } from '../catalog/product.service';
import { findPrimaryImage } from '../catalog/utils/primary-image.util';
import { Store } from '../site-builder/entities/store.entity';
import { User } from '../users/entities/user.entity';
import { CreateOrderDto, OrderItemInputDto } from './dto/create-order.dto';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { OrderStatus } from './enums/order-status.enum';
import { PaymentMethod } from './enums/payment-method.enum';
import { PaymentStatus } from './enums/payment-status.enum';
import { OrderService } from './order.service';
import { DEFAULT_SHIPPING_FEE } from './orders.constants';
import { calculateTotals } from './utils/order-totals.util';
import {
  buildVariantOptions,
  describeVariant,
} from './utils/variant-snapshot.util';

/** A line joined to the variant the server loaded for it. */
interface PricedLine {
  readonly input: OrderItemInputDto;
  readonly variant: ProductVariant;
}

/**
 * Turns a cart into a row, in one transaction.
 *
 * Nothing here trusts the client: prices come from `ProductVariant.priceAmount`
 * read inside the transaction, stock is reserved with a conditional update that
 * simply affects zero rows when it is not there, and the order number is taken
 * with a single `UPDATE ... RETURNING` whose row lock serialises concurrent
 * checkouts on the same store.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly orderService: OrderService,
    private readonly productService: ProductService,
  ) {}

  /**
   * Places an order for the authenticated customer of `slug`. Everything after
   * the commit — a confirmation email, later a payment handoff — belongs outside
   * this method: a failure there must not roll the order back.
   */
  async placeOrder({
    user,
    slug,
    dto,
  }: {
    user: JwtPayload;
    slug: string;
    dto: CreateOrderDto;
  }): Promise<Order> {
    const { store, userId } = await this.orderService.resolveCustomerScope({
      user,
      slug,
    });
    const buyer = await this.loadBuyer(userId, store.id);
    this.assertPaymentMethodIsAvailable(dto.paymentMethod);
    this.assertNoDuplicateVariants(dto.items);

    const orderId = await this.orderRepository.manager.transaction(
      async (manager) => {
        const lines = await this.loadLines(manager, store.id, dto.items);
        await this.reserveStock(manager, store.id, lines);
        return this.insertOrder({ manager, store, buyer, dto, lines });
      },
    );

    return this.orderService.loadFull(store.id, { id: orderId });
  }

  /** The buyer's row, read for the contact details the order snapshots. */
  private async loadBuyer(userId: string, storeId: string): Promise<User> {
    const buyer = await this.userRepository.findOne({
      where: { id: userId, storeId },
    });
    if (!buyer) {
      throw new NotFoundException('Account not found');
    }
    return buyer;
  }

  /**
   * `PaymentMethod.Card` exists on the enum so the column and the later flow
   * need no migration, but nothing can charge a card yet. Accepting one here
   * would write an order that can never be paid, so it is a 400 until
   * payments.md lands.
   */
  private assertPaymentMethodIsAvailable(method: PaymentMethod): void {
    if (method !== PaymentMethod.Cod) {
      throw new BadRequestException(
        'paymentMethod: card payment is not available yet — choose cash on delivery',
      );
    }
  }

  /**
   * Two lines for the same variant leave the quantity ambiguous — is it the sum,
   * or did the client send its cart twice? Merging is the storefront's job.
   */
  private assertNoDuplicateVariants(items: readonly OrderItemInputDto[]): void {
    const ids = new Set(items.map((item) => item.variantId));
    if (ids.size !== items.length) {
      throw new BadRequestException(
        'items: each variant may appear once — merge the quantities instead',
      );
    }
  }

  /**
   * Loads every line's variant in one query, scoped to the store and to what is
   * actually buyable. An id that does not come back is a 400 **naming the
   * product**: "this item is no longer available" is something the storefront can
   * act on, unlike a generic failure.
   */
  private async loadLines(
    manager: EntityManager,
    storeId: string,
    items: readonly OrderItemInputDto[],
  ): Promise<PricedLine[]> {
    const variantIds = items.map((item) => item.variantId);
    const variants = await manager
      .createQueryBuilder(ProductVariant, 'variant')
      .innerJoinAndSelect('variant.product', 'product')
      .leftJoinAndSelect('product.images', 'image')
      .leftJoinAndSelect('variant.attributeValues', 'value')
      .leftJoinAndSelect('value.attribute', 'attribute')
      .where('variant.id IN (:...variantIds)', { variantIds })
      .andWhere('variant.storeId = :storeId', { storeId })
      .andWhere('variant.deletedAt IS NULL')
      .andWhere('product.deletedAt IS NULL')
      .andWhere('product.status = :status', { status: ProductStatus.Active })
      .getMany();

    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    const missing = variantIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        await this.describeUnavailable(manager, storeId, missing),
      );
    }

    return items.map((input) => ({
      input,
      variant: byId.get(input.variantId) as ProductVariant,
    }));
  }

  /**
   * Reserves each line with the conditional update from products.md. Zero rows
   * affected means the stock is not there, and the throw rolls back every
   * earlier reservation in this transaction — which is why the column can never
   * go negative and why no lock is needed.
   */
  private async reserveStock(
    manager: EntityManager,
    storeId: string,
    lines: readonly PricedLine[],
  ): Promise<void> {
    for (const line of lines) {
      const result = await manager
        .createQueryBuilder()
        .update(ProductVariant)
        .set({ stockQuantity: () => '"stockQuantity" - :quantity' })
        .where('id = :variantId')
        .andWhere('"storeId" = :storeId')
        .andWhere('"deletedAt" IS NULL')
        .andWhere('"stockQuantity" >= :quantity')
        .setParameters({
          variantId: line.variant.id,
          storeId,
          quantity: line.input.quantity,
        })
        .execute();

      if (result.affected === 0) {
        throw new ConflictException(
          `${this.describeLine(line)} does not have ${line.input.quantity} left in stock`,
        );
      }
    }

    const productIds = new Set(lines.map((line) => line.variant.productId));
    for (const productId of productIds) {
      await this.productService.recalculateAggregates(productId, manager);
    }
  }

  /** Writes the order and its lines, snapshotting everything they render from. */
  private async insertOrder({
    manager,
    store,
    buyer,
    dto,
    lines,
  }: {
    manager: EntityManager;
    store: Store;
    buyer: User;
    dto: CreateOrderDto;
    lines: readonly PricedLine[];
  }): Promise<string> {
    const totals = calculateTotals({
      items: lines.map((line) => ({
        unitAmount: line.variant.priceAmount,
        quantity: line.input.quantity,
      })),
      shippingFee: DEFAULT_SHIPPING_FEE,
    });

    const orderNumber = await this.takeOrderNumber(manager, store.id);
    const order = manager.create(Order, {
      storeId: store.id,
      orderNumber,
      userId: buyer.id,
      contactName: `${buyer.firstName} ${buyer.lastName}`.trim(),
      contactEmail: buyer.email,
      contactPhone: dto.contactPhone.trim(),
      shippingAddress: dto.shippingAddress.toShippingAddress(),
      status: OrderStatus.Pending,
      paymentStatus: PaymentStatus.Unpaid,
      paymentMethod: dto.paymentMethod,
      currency: store.currency,
      subtotalAmount: totals.subtotalAmount,
      shippingFee: totals.shippingFee,
      totalAmount: totals.totalAmount,
      customerNote: dto.customerNote?.trim() || null,
    });
    await manager.save(order);

    const items = lines.map((line, index) =>
      manager.create(OrderItem, {
        orderId: order.id,
        productId: line.variant.productId,
        variantId: line.variant.id,
        productTitle: line.variant.product.title,
        productSlug: line.variant.product.slug,
        productImageUrl:
          findPrimaryImage(line.variant.product.images)?.url ?? null,
        variantOptions: buildVariantOptions(line.variant.attributeValues),
        sku: line.variant.sku,
        unitAmount: line.variant.priceAmount,
        quantity: line.input.quantity,
        lineTotalAmount: totals.lineTotals[index],
        position: index,
      }),
    );
    await manager.save(items);

    return order.id;
  }

  /**
   * The per-store counter, taken in one statement. `RETURNING` reports the value
   * **after** the increment, so the number this order gets is one below it.
   *
   * The row lock this takes is held for the rest of the transaction, which
   * serialises concurrent checkouts on the same store. That is the price of
   * gapless numbering and is acceptable at MVP volume.
   */
  private async takeOrderNumber(
    manager: EntityManager,
    storeId: string,
  ): Promise<number> {
    const result = await manager
      .createQueryBuilder()
      .update(Store)
      .set({ nextOrderNumber: () => '"nextOrderNumber" + 1' })
      .where('id = :storeId', { storeId })
      .returning('"nextOrderNumber"')
      .execute();

    const raw = result.raw as { nextOrderNumber: number }[];
    const next = Number(raw[0]?.nextOrderNumber);
    if (!Number.isInteger(next)) {
      throw new NotFoundException('Store not found');
    }
    return next - 1;
  }

  /** Names the products behind ids that are no longer buyable, if it still can. */
  private async describeUnavailable(
    manager: EntityManager,
    storeId: string,
    variantIds: readonly string[],
  ): Promise<string> {
    const rows = await manager
      .createQueryBuilder(ProductVariant, 'variant')
      .withDeleted()
      .innerJoin('variant.product', 'product')
      .select('product.title', 'title')
      .where('variant.id IN (:...variantIds)', { variantIds })
      .andWhere('variant.storeId = :storeId', { storeId })
      .getRawMany<{ title: string }>();

    const titles = [...new Set(rows.map((row) => row.title))];
    if (titles.length === 0) {
      return 'items: one of these products is no longer available';
    }
    return `items: ${titles.map((title) => `"${title}"`).join(', ')} is no longer available`;
  }

  private describeLine(line: PricedLine): string {
    return describeVariant({
      title: line.variant.product.title,
      options: buildVariantOptions(line.variant.attributeValues),
    });
  }
}
