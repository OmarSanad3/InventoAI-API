# Orders & Checkout

> Part of the [E-commerce Core](./ecommerce-core.md) epic. Shared decisions live
> there. Depends on [products.md](./products.md). Card payment is layered on top
> by [payments.md](./payments.md); this spec ships **COD only** and is complete
> and shippable on its own.

## Overview

Turning a cart into a row. A logged-in customer of a store posts their line
items and a shipping address; the backend re-prices every line from the
database, reserves stock atomically, writes an immutable snapshot, and hands the
owner a dashboard to work the order through to delivery.

## Goals

- A store's registered customer can place an order and see their own orders.
- Prices and stock are decided by the server, never by the client.
- An order is an immutable record of what was bought at what price, unaffected
  by later edits to the catalog.
- An owner or admin can list, filter, inspect and advance orders.
- Stock cannot be oversold, even under concurrent checkouts.

## Non-goals

- **Guest checkout** — see the open question below. Checkout requires a verified
  account on that store.
- **Discounts, coupons, tax, computed shipping rates.** `shippingFee` is stored
  on the order but is `0` until a shipping-settings feature exists.
- **Card payment** — [payments.md](./payments.md).
- **Partial fulfilment / split shipments / returns workflow.**
- **Customer-facing order emails.** `MailService` exists and this is an obvious
  next step, but notification templates are their own piece of work; see
  Deferred.

## Open question — guest checkout

Requiring registration before a first purchase costs conversions, and it is the
single most likely thing to be revisited in this epic. The design keeps the door
open: make `Order.userId` nullable from day one and store the buyer's contact
details on the order itself (`contactEmail`, `contactName`, `contactPhone`),
populated from the account today. Adding guest checkout then means a public
route and a DTO, not a schema change.

**This spec builds the authenticated path only.** The nullable column and the
contact snapshot ship now purely so the later change is cheap.

## Auth & access control

| Surface | Rule |
| --- | --- |
| `/orders/**` (dashboard) | `JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER, ADMIN)` |
| `/site/:slug/orders/**` (customer) | `JwtAuthGuard` + `StoreScopeGuard` |

`StoreScopeGuard` already rejects a token issued for another store on a `:slug`
route, which is exactly the isolation customer routes need.

Beyond the guard, **every customer route also filters by `userId`**. A customer
of store A must not read another customer of store A's order, and the guard says
nothing about that. Belt and braces: `WHERE storeId = :storeId AND userId =
:userId AND id = :id`, 404 otherwise.

## Data model

### `Order` (new) — `src/orders/entities/order.entity.ts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | `@BeforeInsert` `randomUUID()` |
| `storeId` | `uuid` | `@ManyToOne(() => Store, { onDelete: 'CASCADE' })` |
| `orderNumber` | `int` | Per-store, human-readable — "order #1042" |
| `userId` | `uuid` **nullable** | The buyer; nullable for the guest path that does not exist yet |
| `contactName` | `varchar` | Snapshot — an order must render if the account is deleted |
| `contactEmail` | `varchar` | |
| `contactPhone` | `varchar` | |
| `shippingAddress` | `jsonb` | `{ line1, line2, city, governorate, postalCode, country }` |
| `status` | `enum OrderStatus` | Fulfilment state, see below |
| `paymentStatus` | `enum PaymentStatus` | Money state, see below |
| `paymentMethod` | `enum PaymentMethod` | `cod` only in this spec |
| `currency` | `varchar(3)` | Copied from `Store.currency` at creation |
| `subtotalAmount` | `int` | Sum of line totals, minor units |
| `shippingFee` | `int`, default `0` | |
| `totalAmount` | `int` | `subtotal + shippingFee` |
| `customerNote` | `text` nullable | "Leave it with the doorman" |
| `internalNote` | `text` nullable | Owner-only, never returned on customer routes |
| `cancelledAt` / `cancelReason` | timestamp / varchar, nullable | |
| `createdAt` / `updatedAt` | timestamps | |

Indexes:

```ts
@Index('UQ_orders_store_number', ['storeId', 'orderNumber'], { unique: true })
@Index('IDX_orders_store_status', ['storeId', 'status'])
@Index('IDX_orders_user', ['userId'])
```

No soft delete. An order is a financial record; it is cancelled, never removed.

### `OrderItem` (new) — `src/orders/entities/order-item.entity.ts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `orderId` | `uuid` | `@ManyToOne(() => Order, { onDelete: 'CASCADE' })` |
| `productId` | `uuid` **nullable** | Link back; null if the product row is ever hard-deleted |
| `variantId` | `uuid` **nullable** | Link back to the exact variant bought |
| `productTitle` | `varchar` | **Snapshot** at purchase time |
| `productSlug` | `varchar` | Snapshot — lets the frontend link back |
| `productImageUrl` | `varchar` nullable | Snapshot of the primary image |
| `variantOptions` | `jsonb`, default `{}` | **Snapshot** — `{ "Size": "M", "Colour": "Red" }`, empty for a simple product |
| `sku` | `varchar` nullable | Snapshot of the **variant's** sku |
| `unitAmount` | `int` | **Snapshot** of `ProductVariant.priceAmount` |
| `quantity` | `int` | `@Min(1)` |
| `lineTotalAmount` | `int` | `unitAmount * quantity`, stored so a total never needs recomputing |

The snapshot columns are the point of this table. Repricing a product must not
rewrite history, and a deleted product must not blank an old order.

`variantOptions` is a **denormalised label pair**, not ids — deliberately, and
it is the one place in the catalog where storing attribute text rather than
referencing it by id is correct. An order is a record of what the customer was
shown at the time. If the owner later renames the value "M" to "Medium", every
live product should follow, and every past order should not. Ids would make the
order follow; the snapshot pins it.

### Enums — `src/orders/enums/`

```ts
export enum OrderStatus {
  Pending = 'pending',       // placed, awaiting the owner
  Confirmed = 'confirmed',   // owner accepted it
  Shipped = 'shipped',
  Delivered = 'delivered',
  Cancelled = 'cancelled',
}

export enum PaymentStatus {
  Unpaid = 'unpaid',         // COD before delivery
  Pending = 'pending',       // card, awaiting the provider (payments.md)
  Paid = 'paid',
  Failed = 'failed',
  Refunded = 'refunded',
}

export enum PaymentMethod {
  Cod = 'cod',
  Card = 'card',             // reserved; enabled by payments.md
}
```

Two separate fields, not one merged status, because "shipped but unpaid" (COD)
and "paid but not yet shipped" (card) are both normal and a single enum would
have to enumerate the product of the two.

## The status machine

```
pending ──▶ confirmed ──▶ shipped ──▶ delivered
   │            │            │
   └────────────┴────────────┴──▶ cancelled
```

- Transitions are declared once as a `Record<OrderStatus, OrderStatus[]>` in
  `src/orders/orders.constants.ts` and checked in one place. An illegal
  transition is a `400` naming both states.
- `delivered` and `cancelled` are terminal.
- Cancelling **restores stock** for every line, in a transaction, and only from
  `pending` or `confirmed` — once shipped, the goods have left.
- Delivering a `cod` order sets `paymentStatus = paid` in the same operation.
  That is the entire COD money story.
- **A customer may only cancel while `pending`.** After the owner confirms, they
  ask the owner.

## Endpoints

### Storefront (customer)

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/site/:slug/orders` | `CreateOrderDto` | `OrderResponseDto` (201) |
| `GET` | `/site/:slug/orders/me` | query `PaginationQueryDto` | `PaginatedResponseDto<OrderListItemDto>` |
| `GET` | `/site/:slug/orders/me/:orderNumber` | — | `OrderResponseDto` |
| `POST` | `/site/:slug/orders/me/:orderNumber/cancel` | `CancelOrderDto` (`reason?`) | `OrderResponseDto` |

Customer routes address orders by **`orderNumber`**, not `id` — it is the number
in their confirmation, and it is scoped by store so it leaks nothing global.

### Dashboard

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/orders` | query `OrderQueryDto` | `PaginatedResponseDto<OrderListItemDto>` |
| `GET` | `/orders/:id` | — | `OrderDetailDto` |
| `PATCH` | `/orders/:id/status` | `UpdateOrderStatusDto` | `OrderDetailDto` |
| `PATCH` | `/orders/:id/note` | `UpdateOrderNoteDto` | `OrderDetailDto` |

`OrderQueryDto` extends `PaginationQueryDto`: `status?`, `paymentStatus?`,
`search?` (order number, contact name, contact email), `fromDate?`, `toDate?`,
`sort?` (`createdAt|totalAmount`).

`OrderDetailDto` includes `internalNote`; `OrderResponseDto` (customer-facing)
does not. Two DTOs, not one with a flag — a conditional field is how internal
notes eventually reach a customer.

## Checkout — the transaction

`POST /site/:slug/orders` body:

```json
{
  "items": [{ "variantId": "uuid", "quantity": 2 }],
  "shippingAddress": { "line1": "...", "city": "...", "country": "EG" },
  "contactPhone": "+201234567890",
  "customerNote": "optional",
  "paymentMethod": "cod"
}
```

A line addresses a **variant**, not a product. Since every product has at least
one variant ([ecommerce-core.md](./ecommerce-core.md) §3), this is uniform: the
storefront's add-to-cart sends the picked variant for a clothing item and the
lone default variant for a mug. There is no product-level fallback, because a
fallback would mean guessing which size the customer meant.

Note what is **absent**: no prices, no totals, no `storeId`, no `userId`. Any of
them in the body is a 400 from `forbidNonWhitelisted`, which is the cheapest
possible defence against a client that decides its own totals.

Steps, all inside one `dataSource.transaction`:

1. **Resolve the store** from `:slug`; it must be `live`. A draft store cannot
   take orders.
2. **Validate the cart shape** — 1 to `MAX_ORDER_ITEMS` lines, no duplicate
   `variantId` (merge them client-side; a duplicate is a 400 so the quantity is
   never ambiguous), each `quantity` between 1 and `MAX_ITEM_QUANTITY`.
3. **Load the variants** in one query, joined to their products and their
   attribute values: `WHERE variant.id IN (...) AND variant.storeId = :storeId
   AND product.status = 'active' AND variant.deletedAt IS NULL AND
   product.deletedAt IS NULL`. Any id that does not come back is a `400` naming
   it — "this item is no longer available" is a message the storefront can act
   on, unlike a generic failure.
4. **Reserve stock** per line with the conditional update from
   [products.md](./products.md), against `product_variants`. Zero rows affected
   → throw `ConflictException` naming the product **and its options** ("Blue
   Mug — Size M"), and the transaction rolls back every earlier reservation.
   Then call the product's `recalculateAggregates` in the same transaction so
   `totalStock` never drifts.
5. **Compute the totals** from the freshly-read `priceAmount`, in integers.
6. **Take the order number**:

   ```sql
   UPDATE stores SET "nextOrderNumber" = "nextOrderNumber" + 1
   WHERE id = :storeId RETURNING "nextOrderNumber" - 1 AS "orderNumber"
   ```

   The row lock this takes is held for the rest of the transaction, which
   serialises concurrent checkouts on the same store. That is acceptable at MVP
   volume and is the price of gapless per-store numbering; the alternative is a
   Postgres sequence per store, noted under Considered and rejected.
7. **Insert** the order and its items, snapshotting title, slug, primary image,
   the variant's sku and unit price, and `variantOptions` as
   `{ attributeName: valueText }` built from the values loaded in step 3.
8. Commit. `paymentStatus` is `unpaid`, `status` is `pending`.

Everything after the commit — the confirmation email, the provider handoff — is
outside the transaction, and a failure there must not roll the order back.

## Stock accounting

All stock is per **variant**; a product's `totalStock` is derived and never
written directly.

| Event | Stock |
| --- | --- |
| Order placed | variant decremented (step 4), product aggregates recomputed |
| Order cancelled from `pending` or `confirmed` | restored, aggregates recomputed |
| Order shipped / delivered | unchanged — it left at placement |
| Owner edits `stockQuantity` | absolute set on the variant, not a delta |

Reserving at placement rather than at payment is the right default for COD,
where placement *is* the commitment. [payments.md](./payments.md) inherits this
and must deal with the abandoned-card-payment case it creates.

## Constants — `src/orders/orders.constants.ts`

```ts
export const MAX_ORDER_ITEMS = 50;
export const MAX_ITEM_QUANTITY = 100;
export const MAX_CUSTOMER_NOTE_LENGTH = 500;
export const MAX_INTERNAL_NOTE_LENGTH = 2000;
export const MAX_CANCEL_REASON_LENGTH = 200;

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.Pending]: [OrderStatus.Confirmed, OrderStatus.Cancelled],
  [OrderStatus.Confirmed]: [OrderStatus.Shipped, OrderStatus.Cancelled],
  [OrderStatus.Shipped]: [OrderStatus.Delivered, OrderStatus.Cancelled],
  [OrderStatus.Delivered]: [],
  [OrderStatus.Cancelled]: [],
};
```

## Implementation order

1. Enums, `Order` and `OrderItem` entities, indexes, `OrdersModule` in
   `AppModule`.
2. `OrderService.create` — the whole transaction above. This is the hard part;
   do it before any controller exists and drive it from a test.
3. DTOs, then `PublicOrdersController` (`POST` + `me` routes).
4. `OrdersController` (dashboard list, detail, status, note).
5. The transition table and `updateStatus`, including the stock restore and the
   COD `paid` flip.

## Tests

Unit (pure, no database — extract these as functions):

- `calculateTotals(items)` — integer arithmetic, empty cart, single line, many.
- `assertTransition(from, to)` — every legal edge passes, every illegal one
  throws, terminal states reject everything.

Endpoint checks:

- Happy path: place → appears in `me` and in the dashboard → confirm → ship →
  deliver, `paymentStatus` becomes `paid` on delivery.
- **A price in the body is a 400** (`forbidNonWhitelisted`), and an order placed
  right after the owner raises the price uses the new price.
- Stock 1, quantity 2 → 409, stock unchanged, no order row.
- Two concurrent checkouts for the last unit → exactly one 201, one 409, final
  stock 0. Run them genuinely in parallel; a sequential test proves nothing here.
- `draft` or deleted product in the cart → 400 naming the product.
- Duplicate `variantId` in `items` → 400.
- Store B's variant bought through store A's slug → 400 (the `storeId` filter in
  step 3 makes it invisible).
- **Buying size M when only L has stock → 409 naming "Size M"**, and L's stock
  is untouched. This is the case the whole variant model exists for.
- `variantOptions` is snapshotted: rename the value "M" to "Medium" afterwards
  and the existing order still reads "M", while the product page reads "Medium".
- A simple product's line has `variantOptions: {}` and still renders.
- After a cancel, the product's `totalStock` matches the sum of its variants.
- Customer of store A reading store B's order → 403 from `StoreScopeGuard`;
  customer A1 reading customer A2's order → 404.
- Cancel while `pending` → stock restored. Cancel while `shipped` → 400.
- Illegal transition `pending → delivered` → 400 naming both states.
- Order number increments per store and starts at 1 for a new store.
- Product soft-deleted after the order → the order still renders its title,
  price and image.
- `internalNote` never appears on a customer route.

## Considered and rejected

- **A merged `status` enum covering payment and fulfilment.** Would need
  `shipped_unpaid`, `shipped_paid`, `confirmed_paid`… — the cross product of two
  independent axes.
- **`COUNT(*) + 1` for the order number.** Racy under concurrency, and it
  renumbers after a delete. The `UPDATE ... RETURNING` counter is one statement
  and is correct.
- **A dedicated Postgres sequence per store.** Avoids the row lock, but needs
  dynamic DDL per store and does not survive `synchronize: true` cleanly.
  Revisit if checkout contention ever shows up in practice.
- **Recomputing totals on read.** Cheap-looking, but it means an old order's
  total silently changes when the catalog does. Stored totals are the record.
- **Deleting cancelled orders.** They are the data the Advisor and the reporting
  features will want most.

## Deferred

- Guest checkout (see the open question above — the schema is already ready).
- Order confirmation and status-change emails via `MailService`. Straightforward
  once someone writes the templates; the branded OTP template is the model.
- Shipping fees and zones, tax, coupons.
- Returns and refund workflow.
- Order export (CSV) and printable invoices.
- Abandoned-cart tracking — impossible while the cart is client-side, and a
  reason the decision might be revisited.
