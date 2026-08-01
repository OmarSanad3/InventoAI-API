# Payments

> Part of the [E-commerce Core](./ecommerce-core.md) epic. Layers card payment
> onto the working COD flow in [orders.md](./orders.md), which must ship first.

## Overview

An order can be placed but not paid for online. This adds card payment: the
customer picks `card` at checkout, the backend creates an intent with a payment
provider and returns a URL, the customer pays on the provider's page, and the
provider tells us the result over a signed webhook.

The whole design rests on one rule:

> **The webhook is the only thing that marks an order paid.** The browser
> redirect back from the provider is a hint for the UI and nothing more — it is
> user-controlled and trivially forged.

## Decide before implementing — which provider

The spec is written against a `PaymentProvider` port with one adapter. The
adapter to build first is **Paymob**, because the stated target market is Egypt
and MENA ([project-overview.md](../project-overview.md)) and Stripe does not
support Egyptian payouts. If the deployment target turns out to be elsewhere, a
Stripe adapter implements the same three methods and nothing else in this spec
changes.

**Confirm the provider before writing the adapter** — it decides the env vars,
the webhook signature scheme and the intent-creation call shape. Everything
above the port is provider-agnostic and can be built either way.

## Goals

- A customer can pay by card at checkout, or keep using COD.
- Payment state is driven by verified webhooks, never by the client.
- A webhook delivered twice changes nothing the second time.
- An abandoned card payment eventually releases the stock it reserved.
- The provider integration sits behind an interface, so a second provider or a
  test double does not touch the order module.

## Non-goals

- **Executing refunds through the provider.** An order can be marked `refunded`
  by the owner; calling the refund API is deferred.
- **Split payments / marketplace payouts to store owners** — see the honest
  caveat below.
- **Saved cards, wallets, instalments, 3-D Secure customisation.** Whatever the
  provider's hosted page offers is what customers get.
- **Multi-currency.** One currency per store, from `Store.currency`.

## The settlement caveat — read this

Payments are collected through **one platform-level provider account**, not per
store. Money from every store's customers lands in the InventoAI account, and
paying owners out is a manual, out-of-band process.

That is acceptable for an MVP and a graduation project, and it is not acceptable
for a real multi-tenant SaaS taking real money — it makes InventoAI the merchant
of record for every store, with the regulatory weight that carries. Per-store
sub-merchant accounts (Stripe Connect, Paymob's equivalent) are the real answer
and are a feature of their own. This is written down so nobody discovers it in
production.

## Auth & access control

| Surface | Rule |
| --- | --- |
| `POST /site/:slug/orders` with `paymentMethod: card` | `JwtAuthGuard` + `StoreScopeGuard` (unchanged from orders.md) |
| `POST /site/:slug/orders/me/:orderNumber/pay` | `JwtAuthGuard` + `StoreScopeGuard` |
| `POST /payments/webhook/:provider` | **public**, authenticated by HMAC signature only |

The webhook must be public — the provider has no token. Its authentication is
the signature, and a request that fails verification is a `401` that is logged
and dropped.

## New environment variables

Every one goes in `EnvironmentVariables` with a class-validator decorator, in
`.env.example`, and in `.env`. The app will not boot without them.

| Var | Example | Why |
| --- | --- | --- |
| `PAYMENT_PROVIDER` | `paymob` | Which adapter the factory returns (`@IsIn(['paymob'])`) |
| `PAYMOB_API_KEY` | `ZXlKI...` | Authenticating to the provider |
| `PAYMOB_INTEGRATION_ID` | `4938201` | The card integration to charge through |
| `PAYMOB_IFRAME_ID` | `882031` | Builds the hosted checkout URL |
| `PAYMOB_HMAC_SECRET` | `2C9...` | Verifying webhook signatures |
| `PAYMENT_RETURN_URL` | `https://inventoai.com/payment/return` | Where the provider sends the browser back |
| `ORDER_PAYMENT_TIMEOUT_MINUTES` | `30` | How long an unpaid card order holds its stock |

## Data model

### `Order` gains

| Column | Type | Notes |
| --- | --- | --- |
| `paymentProvider` | `varchar` nullable | Which adapter handled it |
| `paymentReference` | `varchar` nullable | The provider's intent/order id, indexed — this is how a webhook finds the order |
| `paidAt` | `timestamp` nullable | |
| `paymentExpiresAt` | `timestamp` nullable | `createdAt + ORDER_PAYMENT_TIMEOUT_MINUTES`, card only |

```ts
@Index('IDX_orders_payment_reference', ['paymentReference'])
```

`PaymentMethod.Card` becomes selectable; `PaymentStatus.Pending` starts being
used. Both already exist from [orders.md](./orders.md).

### `PaymentTransaction` (new) — `src/payments/entities/payment-transaction.entity.ts`

Every webhook the provider sends, stored before it is acted on.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `orderId` | `uuid` nullable | Null when the webhook cannot be matched to an order |
| `provider` | `varchar` | |
| `providerEventId` | `varchar` | **Unique per provider** — this is the idempotency key |
| `providerReference` | `varchar` | The intent id from the payload |
| `type` | `enum` | `authorized \| captured \| failed \| refunded \| unknown` |
| `amount` | `int` | Minor units, as reported by the provider |
| `currency` | `varchar(3)` | |
| `rawPayload` | `jsonb` | The untouched body — the only way to debug a dispute |
| `processedAt` | `timestamp` nullable | Null means received but not yet applied |
| `createdAt` | timestamp | |

```ts
@Index('UQ_payment_transactions_event', ['provider', 'providerEventId'], { unique: true })
```

The unique index *is* the idempotency mechanism: the insert is attempted first,
and a `23505` means "already handled, return 200 and stop".

## The provider port

`src/payments/payment-provider.interface.ts`:

```ts
export interface CreatePaymentIntentCommand {
  readonly orderId: string;
  readonly orderNumber: number;
  readonly amount: number;        // minor units
  readonly currency: string;
  readonly customer: { name: string; email: string; phone: string };
  readonly returnUrl: string;
}

export interface PaymentIntent {
  readonly reference: string;     // stored as Order.paymentReference
  readonly checkoutUrl: string;   // where the customer is sent
}

export interface PaymentEvent {
  readonly eventId: string;
  readonly reference: string;
  readonly type: PaymentEventType;
  readonly amount: number;
  readonly currency: string;
}

export interface PaymentProvider {
  readonly name: string;
  createIntent(command: CreatePaymentIntentCommand): Promise<PaymentIntent>;
  /** Throws when the signature does not verify. */
  verifyAndParse(rawBody: Buffer, headers: Record<string, string>): PaymentEvent;
}
```

`PaymobProvider implements PaymentProvider` is the only implementation. It is
bound through a Nest custom provider keyed on `PAYMENT_PROVIDER`, so
`OrderService` injects the interface and never learns which one it got.

## The flow

### 1. Checkout with `paymentMethod: card`

Same transaction as [orders.md](./orders.md) — the order is created, stock is
reserved, totals are computed — with two differences:

- `paymentStatus = pending` instead of `unpaid`.
- `paymentExpiresAt` is set.

**The provider call happens after the commit, not inside it.** An HTTP call to a
third party inside a database transaction holds locks for as long as their
servers feel like taking, and this transaction holds the store's order-number
row lock. After committing:

1. `createIntent(...)`.
2. Store `paymentReference` and `paymentProvider` on the order.
3. Return `201` with the order plus `payment: { checkoutUrl }`.

If `createIntent` throws, the order survives as `pending`/`pending` with no
reference, and the customer retries with the `pay` route below. Do **not** roll
the order back — the stock is already reserved and a phantom rollback here is
how double-selling starts.

### 2. Retry — `POST /site/:slug/orders/me/:orderNumber/pay`

For an order that is `status = pending` and `paymentStatus in (pending, failed)`
and not past `paymentExpiresAt`. Creates a fresh intent, overwrites
`paymentReference`, returns a new `checkoutUrl`. Any other state is a `400`.

### 3. The webhook — `POST /payments/webhook/:provider`

1. **Verify the signature** over the *raw* body. `verifyAndParse` throws
   `UnauthorizedException` on a mismatch.
2. **Insert the `PaymentTransaction`** with `processedAt = null`. A `23505` on
   the unique index means this event was already handled → return `200`
   immediately. A replayed webhook must be free, not idempotent-by-accident.
3. **Find the order** by `paymentReference`. Not found → leave the transaction
   with a null `orderId`, log a warning, return `200`. Returning an error would
   make the provider retry forever over something we cannot fix.
4. **Apply the event**, in a database transaction:

   | Event | Effect |
   | --- | --- |
   | `captured` | `paymentStatus = paid`, `paidAt = now`, `status: pending → confirmed` |
   | `failed` | `paymentStatus = failed`, `status = cancelled`, **stock restored** |
   | `refunded` | `paymentStatus = refunded` (fulfilment status untouched — the owner decides) |
   | `authorized` / `unknown` | recorded only |

   Guard every branch: an event for an order already `paid` is ignored, and a
   `failed` event for an order already cancelled must not restore stock twice.
   The stock restore is the dangerous one — make it conditional on the order not
   already being `cancelled`, inside the transaction.
5. Set `processedAt`, return `200`.

### 4. Expiry

An abandoned card payment holds stock until `paymentExpiresAt`. With no
scheduler in the project, expiry is swept **lazily**: before any read of a
store's orders, and before reserving stock at checkout, cancel every order where
`paymentStatus = pending AND paymentExpiresAt < now()` and restore its stock,
in one transaction.

This is a compromise and it is worth naming: a store with no traffic can hold
stock indefinitely. It is correct enough because the sweep runs on exactly the
path that cares — the next checkout. A `@nestjs/schedule` cron replaces it in
one small change once the scheduler the Daily AI Advisor needs exists.

## Implementation notes

- **Raw body is required** for HMAC verification. Nest parses and discards the
  raw buffer by default; enable it in `main.ts`:

  ```ts
  const app = await NestFactory.create(AppModule, { rawBody: true });
  ```

  and read `request.rawBody` in the controller via `@Req()`. Verifying against
  the re-serialised parsed body works until the provider's key order differs
  from `JSON.stringify`'s, and then it fails in production only.
- **The global `ValidationPipe` must not touch the webhook body.** With
  `forbidNonWhitelisted: true`, any provider field not on a DTO is a 400 — and
  providers add fields without asking. Take the body as `unknown`/raw and let
  `verifyAndParse` be the only thing that reads it.
- Compare signatures with `crypto.timingSafeEqual`, not `===`.
- Never log an API key, a full card payload, or the HMAC secret. `rawPayload` in
  the database is fine and necessary; the application log is not.
- The provider's amount is verified against `order.totalAmount` before marking
  paid. A mismatch is a `PaymentTransaction` with `type = unknown` and a loud
  log, not a paid order.

## Implementation order

1. Env vars in `env.validation.ts`, `.env.example`, `.env`.
2. `rawBody: true` in `main.ts`.
3. The port, `PaymentEventType`, `PaymentTransaction` entity, `PaymentsModule`
   with the provider factory.
4. `PaymobProvider` — `createIntent` first, verified by hand against a sandbox
   account before any of the webhook work.
5. `Order` columns and the `card` branch of checkout.
6. `PaymentsController` webhook + `PaymentService.handleEvent`.
7. The `pay` retry route.
8. Lazy expiry sweep.

## Tests

Signature verification and event parsing are pure functions over a fixture
payload — test them properly, they are the security boundary:

- A tampered body fails verification.
- A payload with a valid signature parses to the expected `PaymentEvent`.

Endpoint checks (a sandbox provider account, or a fake adapter bound in the test
module):

- Card checkout returns a `checkoutUrl` and leaves the order
  `pending`/`pending` with a `paymentReference`.
- `captured` webhook → order `confirmed`/`paid`, `paidAt` set.
- **The same webhook replayed** → `200`, nothing changes, one
  `PaymentTransaction` row.
- Webhook with a bad signature → `401`, no row written, nothing changed.
- Webhook for an unknown reference → `200`, transaction row with null `orderId`.
- `failed` webhook → order cancelled, stock restored to its pre-order level.
- `failed` webhook delivered **twice** → stock restored once. This is the bug
  that costs real inventory; test it explicitly.
- Amount mismatch between the webhook and the order → not marked paid.
- `pay` retry on a `delivered` order → 400.
- Expired card order → next checkout sweeps it, stock is back.
- COD checkout still behaves exactly as [orders.md](./orders.md) specifies.

## Considered and rejected

- **Trusting the browser redirect back from the provider.** It is a
  user-controlled GET. Anyone could mark their own order paid by visiting a URL.
- **Marking paid inside the checkout transaction by calling the provider
  synchronously.** Holds the store's order-number lock across a third-party HTTP
  call.
- **Reserving stock only after payment succeeds.** Avoids the abandoned-payment
  problem entirely, but lets two customers pay for the last unit, which is worse
  — a refund and an apology beats a held reservation.
- **Storing the provider's raw payload only in logs.** Disputes are settled
  months later; logs rotate, tables do not.

## Deferred

- Refund execution through the provider API.
- Per-store sub-merchant accounts and automated payouts (see the caveat).
- A second adapter (Stripe) — the port exists so this is additive.
- Wallet / instalment / BNPL integrations Paymob also offers.
- Replacing the lazy expiry sweep with a scheduled job.
