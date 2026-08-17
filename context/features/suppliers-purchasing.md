# From "Low Stock" to "Deal Closed" — Suppliers & Purchase Requests

> Feature 9 of the [project overview](../project-overview.md). Consumes the
> restock signal the [Daily AI Advisor](./daily-ai-advisor.md) already produces,
> and is the last unbuilt half of the smart-inventory story.
>
> **Deliberately the small version.** The overview's step 4 — "AI suggests
> renegotiating when a price is out of line" — is dropped, and the AI does two
> narrow jobs rather than running the flow.

## Overview

The Advisor already says *"Linen Summer Abaya (Size M) has 3.5 days of cover
against a 10-day lead time — reorder 18 units"*. Today that sentence ends in the
dashboard and the owner opens their email client. This feature is the other end
of it: a supplier list, a drafted email, the replies gathered in one place, and
one button that closes the deal.

Five steps, and nothing else:

1. AI drafts the purchase-request email; the owner edits it and sends it to the
   suppliers they picked.
2. AI reads each reply and extracts price, quantity and delivery time.
3. The offers are ranked side by side in the dashboard.
4. The owner picks one.
5. The system emails the winner to confirm and politely declines the rest.

Plus supplier CRUD, which is as plain as it sounds.

## Goals

- An owner or admin can add, edit and remove suppliers, with the delivery-time
  estimate and the free-text notes ("they deliver late") the overview promises.
- One purchase request goes to several suppliers in one action, from an
  AI-drafted email the owner reviewed.
- A supplier's reply becomes structured numbers without the owner retyping them.
- The offers are comparable at a glance, and the comparison is arithmetic rather
  than an opinion.
- Picking one sends both emails — the confirmation and the declines — so the
  loop actually closes.

## Non-goals

- **Negotiation.** No "this price is out of line, counter at X". Dropped by
  request, and it is the part that most needs a human anyway.
- **Automatic ordering.** The Advisor recommends, the owner sends. Nothing here
  emails a supplier without a click.
- **Inbound email plumbing, in this branch.** Replies arrive by paste and the AI
  reads them either way. The automatic path is decided (the owner's Gmail over
  OAuth) and specified below, but it is phase 2 and its own branch.
- **Purchase orders, invoices, payments to suppliers, goods receipt.** A
  confirmed request is the end of this feature. Nothing writes stock back.
- **Supplier ↔ product catalogues.** A supplier is not linked to the products
  they can supply; the owner picks the recipients per request.
- **A supplier portal.** Suppliers have no account and no login. They receive an
  email and reply to it, which is exactly what they do today.

## Decisions

### 1. Phase 1 ships the paste; phase 2 reads the owner's Gmail

Automatic ingestion is a **deployment** problem, not a coding one: something has
to own the address the supplier replies to. So this branch ships the reading and
defers only the transport — the owner pastes the reply, and
`SupplierReplyService.ingest` does exactly the work it will do when a machine
calls it:

```ts
ingest({ offerId, storeId, body }): Promise<SupplierOffer>
```

**Phase 1: no new env var, no new dependency, no new infrastructure.**

**Phase 2 is decided, and it is neither a webhook nor IMAP.** The mail is sent
*as the owner* — `From`/`Reply-To` is their own address, never
`smartapplication2026@gmail.com` — so the reply lands in **their** mailbox, and
we ask them for OAuth access to it. Three consequences make that the right call
rather than a compromise:

- **No domain, no MX records, no public URL.** Everything is outbound, which is
  what an inbound webhook can never be (see the rejected alternatives).
- **Correlation stops being a hack.** Sending through their account returns a
  Gmail `threadId`; store it on the offer and matching a reply is a primary-key
  lookup, not a `[PR-…]` token in a subject line a supplier's client may mangle.
- **The owner keeps their own correspondence.** A supplier who hits reply
  reaches a human at the shop, which is the behaviour phase 1 already has.

The cost is Google's scope tiers, and it is worth stating up front:
`gmail.send` is *sensitive*, but **anything that reads is *restricted*** —
verification plus an annual third-party security assessment before a public
launch. In testing mode it works today, with ≤100 test users and refresh tokens
that expire every 7 days. Which is why phase 2 is a separate branch behind a
per-store connection, and why **the paste route is never deleted**: it is the
fallback for a revoked grant, a non-Gmail owner, and the week the assessment is
in review. The full shape is in
[Phase 2 — automatic ingestion](#phase-2--automatic-ingestion-through-the-owners-gmail).

### 2. The model extracts fields; the code does the arithmetic

Two Gemini calls, both narrow, both `GeminiService.generateJson` with a schema:

- **Draft** — store name, product, variant, quantity, currency, the supplier's
  lead-time estimate and the owner's notes in, `{ subject, body }` out.
- **Extract** — the reply text in, `{ unitPrice, quantity, deliveryDays, notes }`
  out.

The model never sees minor units and never returns them. It reads *"249 EGP per
piece"* and returns `249`; `Math.round(unitPrice * 100)` is the code's job. This
is the lesson the Advisor learned the expensive way — a model handed `1137100`
wrote "1137100 EGP" — pointed the other way: a model asked for minor units will
hand back `249` for a `24900` price, and the offer will read as 100× too cheap
in the one table an owner is about to spend money from.

Nothing else is asked of it. **The ranking is not an AI call** — see below.

### 3. A Gemini outage costs polish, never the flow

Same rule as `AdvisorNarrator`. `buildFallbackRequestEmail` is a template that
says everything the drafted mail must say, so a failed draft is still a sendable
request. A failed *extraction* stores the raw reply with
`extractionStatus: failed` and the owner types the three numbers into
`PATCH …/offers/:offerId` — which exists anyway, because a model reading a
sentence like *"250 for 100 pieces, 350 for fewer"* will sometimes pick the
wrong one and the owner must be able to correct it.

A reply is never lost to a parse failure. `rawReply` is stored before the model
is called.

### 4. The ranking is measured, and it is not just the price

`rankOffers` is a pure helper with unit tests, and it answers the only question
the owner has: *which of these should I take?*

```
total     = unitAmount × (quantity ?? requestedQuantity)
isLate    = neededWithinDays !== null && deliveryDays > neededWithinDays
order     = on-time before late, then total ASC, then deliveryDays ASC,
            then createdAt ASC (determinism)
```

The first row is `isRecommended`. `isCheapest` and `isFastest` are flagged
separately and on purpose: when the recommendation is neither, the owner can see
why in the same table rather than wondering whether the sort is broken.

An offer with no price is **unrankable**, not last-with-a-zero: `rank: null`,
sorted after everything, never recommended, and it still renders — an awaiting
supplier and a failed extraction are both facts the owner needs on screen.

### 5. The recipient list *is* the offer list

There is no `purchase_request_recipients` join table. Sending creates one
`SupplierOffer` per recipient with `status: awaiting` and no numbers, and a
reply fills it in. One table fewer, and "who did we ask, and who has answered"
is one query.

`sentAt` is nullable on that row, which makes `POST /send` idempotent: it mails
only the offers that have never been mailed. A mail that fails leaves its offer
unsent and the request reports it; pressing send again retries exactly those.

### 6. The supplier is snapshotted onto the offer

`supplierName` and `supplierEmail` are copied onto `SupplierOffer` at send time,
the way `OrderItem` snapshots a product. That is what lets `Supplier` be deleted
without a past deal losing the name of who offered it, and it is why the delete
can stay as simple as the request asks for.

### 7. Nothing imports this module

`src/suppliers` imports `CatalogModule` (to resolve the variant it is reordering)
and `SiteBuilderModule` (for `StoreService`); `AiModule` and the global
`MailModule` do the rest. **It does not import `AdvisorModule`, and the Advisor
does not import it** — the Advisor is the leaf of the graph and stays there. The
link between "reorder 18 units" and this feature is the dashboard: the restock
insight's payload already carries `variantId` and `recommendedQuantity`, and the
button posts them to `POST /purchase-requests`.

## Auth & access control

| Surface | Rule |
| --- | --- |
| `/suppliers/**` | `JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER, ADMIN)` |
| `/purchase-requests/**` | `JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER, ADMIN)` |

No storefront surface at all. No route takes a slug, and no shopper can reach
any of this. Store scope comes from `StoreService.resolveCallerStore(user)`; a
row of another store **404s**, never 403.

## Data model

### `Supplier` — `src/suppliers/entities/supplier.entity.ts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | `@BeforeInsert` `randomUUID()` |
| `storeId` | `uuid` | `@ManyToOne(() => Store, { onDelete: 'CASCADE' })` |
| `name` | `varchar(120)` | Trimmed on write |
| `contactEmail` | `varchar(255)` | Lowercased on write |
| `phone` | `varchar(30)`, nullable | |
| `leadTimeDays` | `int`, default `DEFAULT_SUPPLIER_LEAD_TIME_DAYS` | This supplier's own estimate |
| `notes` | `text`, nullable | The owner's "they deliver late" — read by the drafting prompt |
| `isActive` | `boolean`, default `true` | Inactive suppliers are hidden from the picker, not deleted |
| `deletedAt` | `timestamp`, nullable | `@DeleteDateColumn()` |
| timestamps | | |

```ts
@Index('IDX_suppliers_store_name', ['storeId', 'name'])
@Index('UQ_suppliers_store_email', ['storeId', 'contactEmail'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
```

Soft-deleted, like `Category` and `Product`, because purchase requests point at
the row. The offer's snapshot means a deleted supplier still renders in history;
the soft delete means the link survives for reporting.

### `PurchaseRequest` — `src/suppliers/entities/purchase-request.entity.ts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `storeId` | `uuid` | `CASCADE` |
| `productId` / `variantId` | `uuid`, nullable | `ON DELETE SET NULL` — links back, not the source of truth |
| `productTitle` | `varchar(255)` | Snapshot |
| `variantLabel` | `varchar(255)`, nullable | `"Size: M, Colour: Navy"`, or `null` for a simple product |
| `quantity` | `int` | What is being asked for |
| `neededWithinDays` | `int`, nullable | Drives `isLate`; defaults from the variant's own lead-time picture, editable |
| `subject` | `varchar(200)` | The drafted subject, owner-editable |
| `body` | `text` | The drafted body, owner-editable, plain text |
| `note` | `varchar(500)`, nullable | The owner's steer for the draft ("ask about bulk pricing") |
| `status` | `enum` | `draft \| sent \| replied \| confirmed \| cancelled` |
| `draftStatus` | `enum` | `ai \| fallback` — which wrote the body, the same record `narratorStatus` keeps |
| `sentAt` / `confirmedAt` | `timestamp`, nullable | |
| `confirmedOfferId` | `uuid`, nullable | The deal |
| timestamps | | |

```ts
@Index('IDX_purchase_requests_store_created', ['storeId', 'createdAt'])
```

Never deleted, only cancelled — the same rule `Order` has, and for the same
reason: it is a record of money the store was about to spend.

### `SupplierOffer` — `src/suppliers/entities/supplier-offer.entity.ts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `storeId` | `uuid` | Denormalised so every read is scoped without a join |
| `purchaseRequestId` | `uuid` | `ON DELETE CASCADE` |
| `supplierId` | `uuid`, nullable | `ON DELETE SET NULL` |
| `supplierName` / `supplierEmail` | `varchar` | Snapshot at send time |
| `status` | `enum` | `awaiting \| received \| won \| declined` |
| `unitAmount` | `int`, nullable | **Minor units**, in `Store.currency` |
| `quantity` | `int`, nullable | What the supplier actually offered, which is not always what was asked |
| `deliveryDays` | `int`, nullable | |
| `notes` | `varchar(500)`, nullable | Anything else the model found worth keeping |
| `rawReply` | `text`, nullable | Stored **before** extraction runs |
| `extractionStatus` | `enum`, nullable | `parsed \| failed \| manual` |
| `sentAt` / `repliedAt` / `decidedAt` | `timestamp`, nullable | |
| timestamps | | |

```ts
@Index('IDX_supplier_offers_request', ['purchaseRequestId'])
```

`totalAmount` is **not** a column. It is `unitAmount × quantity` and belongs in
the DTO — a stored copy is a denormalised number with no single writer, which
is the mistake `recalculateAggregates` exists to prevent.

## The two state machines

```
PurchaseRequest:  draft ──send──▶ sent ──first reply──▶ replied ──confirm──▶ confirmed
                    └──────────── cancel ────────────┘
                                                       (confirmed is terminal)

SupplierOffer:    awaiting ──reply──▶ received ──┬─pick this one──▶ won
                                                 └─pick another──▶ declined
```

`assertRequestTransition` is a pure helper over a `PURCHASE_REQUEST_TRANSITIONS`
map, the same shape as `ORDER_STATUS_TRANSITIONS`. Confirm is the only writer of
`won`/`declined`, it is one transaction, and it refuses:

- an offer with no `unitAmount` — **you cannot pick a deal that has no price**;
- a request already `confirmed` or `cancelled` (409);
- an offer belonging to another request (404).

The two emails go out **after** the transaction commits, under
`Promise.allSettled`. A decline that fails to send is a logged warning, not a
rolled-back deal — the owner's decision is recorded either way.

## Endpoints

### Suppliers — `src/suppliers/suppliers.controller.ts`

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/suppliers` | `CreateSupplierDto` | `SupplierResponseDto` (201) |
| `GET` | `/suppliers` | `ListSuppliersQueryDto` | `PaginatedResponseDto<SupplierResponseDto>` |
| `GET` | `/suppliers/:id` | — | `SupplierResponseDto` |
| `PATCH` | `/suppliers/:id` | `UpdateSupplierDto` | `SupplierResponseDto` |
| `DELETE` | `/suppliers/:id` | — | `MessageResponseDto` |

`search` is `ILIKE` over name and email, `isActive` filters. That is the whole
CRUD, and it is meant to be boring.

### Purchase requests — `src/suppliers/purchase-requests.controller.ts`

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/purchase-requests` | `CreatePurchaseRequestDto` | `PurchaseRequestDetailDto` (201) |
| `GET` | `/purchase-requests` | `ListPurchaseRequestsQueryDto` | `PaginatedResponseDto<PurchaseRequestResponseDto>` |
| `GET` | `/purchase-requests/:id` | — | `PurchaseRequestDetailDto` (offers, ranked) |
| `PATCH` | `/purchase-requests/:id` | `UpdatePurchaseRequestDto` | `PurchaseRequestDetailDto` |
| `POST` | `/purchase-requests/:id/send` | — | `PurchaseRequestDetailDto` |
| `POST` | `/purchase-requests/:id/cancel` | — | `PurchaseRequestDetailDto` |
| `POST` | `/purchase-requests/:id/offers/:offerId/reply` | `SubmitReplyDto` | `SupplierOfferDto` |
| `PATCH` | `/purchase-requests/:id/offers/:offerId` | `UpdateOfferDto` | `SupplierOfferDto` |
| `POST` | `/purchase-requests/:id/offers/:offerId/confirm` | — | `PurchaseRequestDetailDto` |

`POST /purchase-requests` takes `{ variantId, quantity, supplierIds[],
neededWithinDays?, note? }`, resolves and snapshots the variant, calls Gemini
once for the draft, and returns a request in `draft` with its recipients
already listed as `awaiting` offers. **It sends nothing.**

`PATCH /purchase-requests/:id` accepts `subject`, `body`, `quantity`,
`neededWithinDays` and `supplierIds`, and only while the request is `draft`.
Editing after send is a 409: the suppliers have already read the old one.

## DTOs — `src/suppliers/dto/`

| File | Shape |
| --- | --- |
| `create-supplier.dto.ts` | `name` (`@Length(2, 120)`), `contactEmail` (`@IsEmail()`), `phone?`, `leadTimeDays?` (`@Min(1) @Max(MAX_LEAD_TIME_DAYS)`), `notes?` (`@MaxLength(1000)`), `isActive?` |
| `update-supplier.dto.ts` | Same, all optional |
| `list-suppliers-query.dto.ts` | extends `PaginationQueryDto` — `search?`, `isActive?` (`@ToBoolean()`) |
| `create-purchase-request.dto.ts` | `variantId` (uuid), `quantity` (`@Min(1) @Max(MAX_REQUEST_QUANTITY)`), `supplierIds` (`@ArrayMinSize(1) @ArrayMaxSize(MAX_RECIPIENTS_PER_REQUEST)`, each uuid), `neededWithinDays?`, `note?` |
| `update-purchase-request.dto.ts` | `subject?`, `body?`, `quantity?`, `neededWithinDays?`, `supplierIds?` |
| `submit-reply.dto.ts` | `body` (`@Length(1, MAX_REPLY_LENGTH)`) |
| `update-offer.dto.ts` | `unitAmount?` (`@IsInt() @Min(0)`), `quantity?`, `deliveryDays?`, `notes?` — a manual write sets `extractionStatus: manual` |
| `supplier-response.dto.ts` | the row, no `storeId` |
| `supplier-offer.dto.ts` | the row **plus** `totalAmount`, `rank`, `isRecommended`, `isCheapest`, `isFastest`, `isLate` |
| `purchase-request-response.dto.ts` | the row, `offerCount`, `receivedCount` |
| `purchase-request-detail.dto.ts` | extends the above with `offers: SupplierOfferDto[]`, ranked |

No DTO declares a `storeId`, as everywhere else.

## Prompts — `src/suppliers/prompts/`

`draft-request.prompt.ts` — the store's name and what it sells, the product,
the variant, the quantity, the currency **already formatted**, the supplier's
name and lead-time estimate, the owner's notes about them, and the owner's
`note`. Asked for a short, plain, professional email that asks for unit price,
availability for the quantity, and delivery time. No markdown, no placeholders
like `[Your Name]` — the sign-off is the store's name, which the prompt is
given.

`extract-offer.prompt.ts` — the reply text and the currency it is expected in.
Asked for `{ unitPrice, quantity, deliveryDays, notes }`, every field nullable,
and told explicitly to return `null` rather than guess. A missing price is a
fact; an invented one is a purchase order.

The supplier `notes` field goes into a prompt, so it is owner-written text
reaching a model — but the output is a draft the same owner reads before
anything is sent, which is the mitigation. The body is mailed as plain text and
HTML-escaped into the branded shell.

## Mail — `src/mail/`

Two additions, following `sendAdvisorBrief` exactly:

- `sendSupplierRequest({ to, brand, subject, body, replyToName })` —
  `templates/supplier-request-email.template.ts`.
- `sendSupplierDecision({ to, brand, outcome, productTitle, quantity })` —
  `templates/supplier-decision-email.template.ts`, where `outcome` is
  `'confirmed' | 'declined'`. One template, two intros: the confirmation repeats
  the agreed price, quantity and delivery time; the decline thanks them and says
  the store went another way. No reason is given, and none should be.

Branded with the **store's** `MailBrand`, not the platform's — the supplier is
dealing with Layali, not with InventoAI.

## Constants — `src/suppliers/suppliers.constants.ts`

```ts
export const MAX_SUPPLIERS_PER_STORE = 100;
export const MAX_RECIPIENTS_PER_REQUEST = 10;
export const SUPPLIER_NOTES_MAX_LENGTH = 1000;
export const REQUEST_SUBJECT_MAX_LENGTH = 200;
export const REQUEST_BODY_MAX_LENGTH = 4000;
export const MAX_REQUEST_QUANTITY = 100_000;
export const MAX_OFFER_DELIVERY_DAYS = 365;
export const MAX_REPLY_LENGTH = 10_000;
/** A draft wants the boring answer, like the catalog generator. */
export const REQUEST_DRAFT_TEMPERATURE = 0.6;
/** Extraction wants the same number twice from the same text. */
export const OFFER_EXTRACTION_TEMPERATURE = 0.1;
```

`DEFAULT_SUPPLIER_LEAD_TIME_DAYS` and `MAX_LEAD_TIME_DAYS` already exist in
[advisor.constants.ts](../../src/advisor/advisor.constants.ts) and are imported
rather than redeclared.

**No new environment variable.** Both calls use `GEMINI_MODEL` — a store sends a
handful of requests a week, so this is not the daily-quota pressure that gave
the chatbot and the Advisor their own models.

## Module wiring

```ts
@Module({
  imports: [
    TypeOrmModule.forFeature([Supplier, PurchaseRequest, SupplierOffer]),
    AuthModule,
    SiteBuilderModule,   // StoreService — no forwardRef, nothing reads back
    CatalogModule,       // ProductVariant lookup for the snapshot
    AiModule,
  ],
  ...
})
export class SuppliersModule {}
```

Registered in `AppModule`. Nothing exports from it and nothing imports it.

Services, one job each — `SupplierService` (CRUD), `PurchaseRequestService`
(create, edit, send, cancel, confirm — the writer of `status`),
`SupplierDraftService` (the Gemini draft + the fallback),
`SupplierReplyService` (`ingest`, the extraction, the manual correction).

## Implementation order

1. Enums, `suppliers.constants.ts`, and the two pure helpers with their tests:
   `rankOffers` and `assertRequestTransition`.
2. `Supplier` entity + indexes, `SupplierService`, its DTOs and
   `SuppliersController`. This half is shippable on its own.
3. `PurchaseRequest` + `SupplierOffer` entities.
4. `SupplierDraftService` — prompt, schema, `buildFallbackRequestEmail`.
5. `PurchaseRequestService` — create, edit, send (with the two mail templates),
   cancel.
6. `SupplierReplyService` — `ingest`, extraction, manual correction.
7. Confirm: the transaction, then the two emails.
8. DTOs and `PurchaseRequestsController`.
9. Seed.

## Seed

`SEED_STORES` gains a `suppliers` list: three for `layali` (one with notes that
say they are slow, one inactive), two for `fokhar`, none for `draftco`.

One purchase request per live store, seeded straight into `replied` with three
offers — **cheap but slow, fast but expensive, and one still `awaiting`** — so
the ranking table is visible in the dashboard without SMTP, without Gemini and
without waiting for a supplier. `npm run seed -- --force` prints a **suppliers**
block per store with the request id.

## Tests

Unit (`src/suppliers/utils/`):

- `rankOffers` — cheapest wins; a late cheap offer loses to an on-time one; an
  offer with a null price ranks `null` and sorts last; `isCheapest`/`isFastest`
  can land on rows that are not `isRecommended`; equal totals break on
  `deliveryDays` then `createdAt`; an empty list returns an empty list.
- `assertRequestTransition` — every legal edge, `confirmed` and `cancelled`
  terminal, a no-op transition rejected.
- `buildFallbackRequestEmail` — contains the product, the quantity and the
  store's name, and asks the three questions.

Endpoint:

- Supplier CRUD round-trips; a duplicate email in the same store 400s and the
  same email in another store succeeds; the 101st supplier 400s; a soft-deleted
  supplier's email is immediately reusable.
- Create → `draft`, N `awaiting` offers, nothing mailed.
- Send → offers get `sentAt`, request is `sent`; sending twice mails nobody
  twice.
- Paste a reply → `received` with the three numbers, `unitAmount` in minor units
  (`"249 EGP"` → `24900`), request flips to `replied`.
- A reply the model cannot parse → `extractionStatus: failed`, `rawReply`
  stored, and `PATCH …/offers/:offerId` fixes it to `manual`.
- Confirm → one `won`, the rest `declined`, request `confirmed`,
  `confirmedOfferId` set; confirming again 409s; confirming a priceless offer
  400s.
- Cancel from `draft` and from `sent`; cancel after `confirmed` 400s.
- Store B's supplier, request and offer ids each 404 for store A's owner, and
  the rows survive the attempt.
- An `ADMIN` of the store sees byte-for-byte what its `OWNER` does; a `USER`
  token 403s; no token 401s; a garbage token 401s.
- `storeId` in any body 400s.
- With the Gemini key broken: create still returns a request with a body and
  `draftStatus: fallback`, and a pasted reply still stores `rawReply` with
  `extractionStatus: failed`.

## What landed — deviations from this spec

All deliberate, and all found while building or verifying.

- **One drafted email per request, not per recipient.** The spec's fallback
  helper took a `supplierName` and the prompt took the supplier's notes, which
  only makes sense if every recipient gets their own generation — three
  suppliers, three Gemini calls, and three texts the owner has to review. The
  body is now written once and greets nobody; `Dear <supplier>,` is added per
  recipient by the mail template. `Supplier.notes` therefore no longer reaches
  the model: it is the owner's own memory, shown in the dashboard.
- **The sign-off is added in code, not asked for.** `gemini-3.1-flash-lite`
  returns `"… within 10 days. Layali Abayas"` — the store's name welded to the
  last sentence, because a lite model writing into a JSON string is careless
  with newlines. `appendSignOff` strips whatever closing the model wrote and
  appends the store's own, so the model is now told **not** to sign off at all.
  Same rule as everywhere else here: the wording is the model's, the facts are
  not.
- **`sanitizeExtractedOffer` is a third pure helper with its own tests.** The
  spec put the major→minor conversion in prose; it is the single most expensive
  mistake this feature can make, so it is a function with 14 tests rather than
  three lines inside a service.
- **The reply and offer-edit routes return the whole request, not one offer.**
  The spec's table says `SupplierOfferDto`. A new price re-ranks every other
  row, so a client handed only its own row would draw a stale table.
- **`ProductService.findStockLevel` applies no product-status filter**, unlike
  `listStockLevels` beside it. Reordering stock for a product that has not
  launched yet is exactly what an owner does the week before it does. It is the
  only change to merged code this branch needed, and it is additive.
- **`contactEmail` is trimmed in the DTO, before validation.** A pasted address
  carries a trailing space and `@IsEmail()` rejects it — a 400 whose cause is
  invisible in the dashboard. Found by the endpoint pass, which sent one.
- **`MIN_LEAD_TIME_DAYS` (1) is a new constant.** `AdvisorSettings` allows `0`
  because "no lead time to speak of" is a legitimate thing to say about a whole
  store; a named supplier's own estimate is not.
- **A supplier who was never emailed is not sent a decline.** They would be
  declined for a request they never received. Their offer row is still marked
  `declined`, because the owner did decide.
- **`send` is a 400 when every recipient has already been mailed**, rather than
  a no-op 200. It is the only way the owner learns that the button did nothing.
- **The confirm write is conditional on the status it read**, and a lost race is
  a 409. Not in the spec, and the same reasoning as the stock reservation in
  checkout.

## Phase 2 — automatic ingestion through the owner's Gmail

> Not in this branch. Written here because the shape of phase 1 was chosen to
> make it a bolt-on, and because the scope decision below has a cost that has to
> be seen before anyone commits to a launch date.

### What it is

The store owner connects their Google account once. We then **send the request
through their Gmail** and **poll the same mailbox for replies to the threads we
created**. No inbound mail server, no MX record, no public URL — every call is
outbound, which is why this works from a laptop and a webhook cannot.

```
   owner connects Google  (per store, revocable)
            │
   send  ──▶ gmail.users.messages.send  ──▶ returns { id, threadId }
            │                                        │
            │                            offer.gmailThreadId = threadId
            ▼                                        │
   supplier replies into that thread ◀───────────────┘
            │
   cron ──▶ gmail.users.history.list(startHistoryId)  ──▶ new message ids
            │   skip SENT, drafts, auto-replies, mailer-daemon
            ▼
        SupplierReplyService.ingest()   ← unchanged apart from dedupe
```

### The scope bill, before anything else

| Need | Scope | Google's tier | What it costs |
| --- | --- | --- | --- |
| Send as the owner | `gmail.send` | **sensitive** | app verification |
| Read the replies | `gmail.readonly` | **restricted** | verification **+ annual paid security assessment** |
| Read via IMAP | `https://mail.google.com/` | **restricted, widest** | the same, for more access than we need |

There is no "read only the threads my app created" scope, so reading one reply
means being granted the mailbox. Two rules follow and neither is negotiable:

- **Ask for `gmail.readonly`, never `gmail.modify`.** Write access to a mailbox
  we only read from is scope we would be asked to justify and could not.
- **Fetch by `threadId` only.** Never search the inbox. The grant is total; the
  usage must be visibly narrow.

In **testing** publishing status this works immediately — ≤100 hand-added test
users, an "unverified app" consent screen, and **refresh tokens that expire
after 7 days**. That is fine for a demo and fatal for a live store, so the
connection must treat "we lost access" as an ordinary state, not an exception.

### Data model

```
  stores 1───1 gmail_connections
      storeId, googleEmail,
      refreshToken           ← encrypted at rest; it is a key to a human's mail
      scopes, historyId      ← the sync watermark
      status: connected | expired | revoked,
      lastSyncedAt, lastError
```

Plus two columns on rows this branch already wrote:

| Column | Where | Why |
| --- | --- | --- |
| `gmailThreadId` | `SupplierOffer` | the correlation key, captured **at send time** |
| `gmailMessageId` | `SupplierOffer`, unique | idempotency — the one change inside `ingest` |

### The three rules that make it safe

- **`ingest` becomes insert-if-absent.** A human pastes once; a sync retries. A
  reprocessed history page must not re-run Gemini over a price the owner has
  since corrected by hand. Same discipline as `contentHash` in the knowledge
  base, and it must land **before** the cron is switched on.
- **The sync is a watermark, not a search.** `history.list(startHistoryId)`,
  advancing `historyId` only after the DB commit; a `404` (watermark too old)
  falls back to re-reading the threads we know about by `threadId`. One Redis
  lock, as `KnowledgeSweeper` and `AdvisorScheduler` already take, so two
  instances do not both sync. Only poll stores with an open `sent`/`replied`
  request — holding an unused grant is exactly what an assessor asks about.
- **Losing access degrades, never breaks.** `invalid_grant` marks the connection
  `revoked`, stops the polling, and raises "reconnect Gmail" in the dashboard —
  the shape `vectorSearchAvailable: false` already has. The paste route keeps
  working throughout, which is what makes that acceptable.

### What it does not cover

**Gmail owners only.** Outlook is Microsoft Graph — a second OAuth integration
with its own review — and a cPanel mailbox is plain IMAP with a password the
owner would paste in. So the sender/reader goes behind a `MailboxProvider` port
with `GmailProvider` as the first adapter, the same shape `EmbeddingProvider`
and `WeatherProvider` have. `MailService` over SMTP stays as the fallback for
every store that has connected nothing.

### Order of work

1. [Google Sign-In](./google-oauth.md) first — it stands up the Cloud project,
   the consent screen and the client id, and turns this into an **incremental**
   consent on an account the owner has already linked. It also keeps the
   restricted scope off every shopper's signup.
2. `MailboxProvider` port + `GmailProvider`; `SupplierMailService` sends through
   it and stores the returned `threadId`.
3. `gmailMessageId` + insert-if-absent in `ingest`.
4. `GmailConnection`, the OAuth connect/disconnect routes, encrypted token
   storage.
5. The sync cron, under a Redis lock, per store with an open request.
6. Launch task, not a build task: verification + the CASA assessment. It changes
   no code — only a publishing status.

## Considered and rejected

- **Any automatic ingestion in this branch.** A provider account, a public
  domain and a reply-matching scheme, for a step the owner can do with ⌘V.
  `SupplierReplyService.ingest` is the seam; phase 2 is a new caller of it.
- **An inbound-mail webhook on a platform domain** (SendGrid Inbound Parse,
  Mailgun Routes, plus-addressed `Reply-To`). Genuinely cheaper in Google
  terms — no restricted scope, no assessment — and rejected because of what it
  does to the conversation: replies would land in a platform mailbox instead of
  the owner's, so the owner stops owning the thread with their own supplier and
  we owe them a forwarding story. It also needs a domain, MX records and a
  deployed HTTPS endpoint, none of which exist yet. Worth revisiting **only** if
  the Google assessment turns out to be a hard blocker.
- **IMAP, even once we hold the owner's OAuth token.** Same job as the Gmail
  API, but IMAP demands `https://mail.google.com/` — full mailbox control, the
  broadest scope Google publishes — where the API needs `gmail.readonly`. It
  also brings `UIDVALIDITY` and flag-based state where the API has a clean
  `historyId` cursor. Asking for more access to write more code is a trade with
  no upside.
- **Polling the platform's own mailbox.** It never sees anything: `Reply-To` is
  the owner by design, so the reply is never delivered to us.
- **Asking the model to rank the offers.** The comparison is `price × quantity`
  against a delivery date. Handing that to a model would put the one number an
  owner spends money from outside the code that can be tested — the exact rule
  the Advisor's "every number is measured" exists for.
- **Auto-sending the request from the Advisor's restock insight.** The overview
  says "→ Reordering 60 units now", and it is the one line in it this project
  should not take literally: an agent that emails suppliers unattended is a
  purchase nobody approved.
- **A `supplier_products` link table.** Real, and premature. The owner picks
  recipients per request, and when that becomes tedious the fix is a default
  supplier per category — one column, later.
- **Storing `totalAmount` on the offer.** A second copy of a product of two
  columns, with no single writer. It belongs in the DTO.
- **A `Deal`/`PurchaseOrder` entity for the confirmed offer.** The confirmed
  offer *is* the deal — `status: won` and `confirmedOfferId`. A second entity
  earns its place when goods receipt exists.
- **Hard-deleting suppliers.** The request asks for "remove", and it gets one —
  but a hard delete would orphan the `supplierId` on every past offer. The
  snapshot plus a soft delete gives the owner the same button and keeps history
  readable.

## Deferred

- **Automatic reply ingestion** — phase 2 above: the owner's Gmail over OAuth,
  `threadId` correlation, and a watermarked sync calling
  `SupplierReplyService.ingest`. Blocked on nothing technical; sequenced behind
  [Google Sign-In](./google-oauth.md).
- **Renegotiation** — the overview's step 4, dropped from this spec.
- **Receiving stock** — a confirmed deal writing `stockQuantity` back through
  the catalog's single writer when the goods arrive. This is also what would
  make an `InventoryEvent` table finally necessary.
- **Per-supplier lead time feeding the Advisor.** `Supplier.leadTimeDays` now
  exists per row while `AdvisorSettings.leadTimeDays` is still store-wide; the
  Advisor keeps using its own until a supplier is linked to a product.
- **Supplier performance** — promised versus actual delivery, "they deliver
  late" measured rather than typed.
- **Attachments** — a supplier's PDF quotation, read the way the reply text is.
