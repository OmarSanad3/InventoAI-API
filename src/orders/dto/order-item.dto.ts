import { OrderItem } from '../entities/order-item.entity';

/**
 * A line as it is rendered — entirely from the snapshot, never from the live
 * catalog. A product that has since been repriced, renamed or deleted still
 * shows what the customer actually bought.
 */
export class OrderItemDto {
  id!: string;
  productId!: string | null;
  variantId!: string | null;
  productTitle!: string;
  productSlug!: string;
  productImageUrl!: string | null;
  /** `{ "Size": "M" }`, or `{}` for a simple product. */
  variantOptions!: Record<string, string>;
  sku!: string | null;
  unitAmount!: number;
  quantity!: number;
  lineTotalAmount!: number;

  static fromEntity(item: OrderItem): OrderItemDto {
    const dto = new OrderItemDto();
    dto.id = item.id;
    dto.productId = item.productId;
    dto.variantId = item.variantId;
    dto.productTitle = item.productTitle;
    dto.productSlug = item.productSlug;
    dto.productImageUrl = item.productImageUrl;
    dto.variantOptions = item.variantOptions ?? {};
    dto.sku = item.sku;
    dto.unitAmount = item.unitAmount;
    dto.quantity = item.quantity;
    dto.lineTotalAmount = item.lineTotalAmount;
    return dto;
  }
}
