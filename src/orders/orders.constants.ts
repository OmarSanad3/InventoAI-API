import { OrderStatus } from './enums/order-status.enum';

export const MAX_ORDER_ITEMS = 50;
export const MAX_ITEM_QUANTITY = 100;
export const MAX_CUSTOMER_NOTE_LENGTH = 500;
export const MAX_INTERNAL_NOTE_LENGTH = 2000;
export const MAX_CANCEL_REASON_LENGTH = 200;

export const CONTACT_NAME_MAX_LENGTH = 120;
export const CONTACT_EMAIL_MAX_LENGTH = 200;
export const CONTACT_PHONE_MIN_LENGTH = 6;
export const CONTACT_PHONE_MAX_LENGTH = 32;

export const ADDRESS_LINE_MAX_LENGTH = 200;
export const ADDRESS_CITY_MAX_LENGTH = 100;
export const ADDRESS_GOVERNORATE_MAX_LENGTH = 100;
export const ADDRESS_POSTAL_CODE_MAX_LENGTH = 20;
/** ISO 3166-1 alpha-2, uppercased on write. */
export const ADDRESS_COUNTRY_LENGTH = 2;

/** No shipping-settings feature exists yet, so every order ships free. */
export const DEFAULT_SHIPPING_FEE = 0;

/** What the dashboard's `search` matches an order number against. */
export const ORDER_NUMBER_SEARCH_PATTERN = /^#?(\d{1,9})$/;

/**
 * The status machine, declared once and checked in one place. `delivered` and
 * `cancelled` are terminal: an order that arrived or was called off does not
 * move again.
 */
export const ORDER_STATUS_TRANSITIONS: Record<
  OrderStatus,
  readonly OrderStatus[]
> = {
  [OrderStatus.Pending]: [OrderStatus.Confirmed, OrderStatus.Cancelled],
  [OrderStatus.Confirmed]: [OrderStatus.Shipped, OrderStatus.Cancelled],
  [OrderStatus.Shipped]: [OrderStatus.Delivered, OrderStatus.Cancelled],
  [OrderStatus.Delivered]: [],
  [OrderStatus.Cancelled]: [],
};

/**
 * Cancelling from these puts the goods back on the shelf. Once shipped they
 * have physically left, so a later cancellation is a write-off the owner
 * records rather than stock the system invents.
 */
export const STOCK_RESTORING_STATUSES: readonly OrderStatus[] = [
  OrderStatus.Pending,
  OrderStatus.Confirmed,
];

/** A customer may call off their own order only before the owner accepts it. */
export const CUSTOMER_CANCELLABLE_STATUSES: readonly OrderStatus[] = [
  OrderStatus.Pending,
];
