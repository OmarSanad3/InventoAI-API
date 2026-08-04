# E-commerce Core — Index

## Overview

The site builder can now produce a live store: branding, theme, hero block, and
a public `GET /site/:slug` the storefront renders from. What it cannot do is
sell anything. There is no catalog, no orders, and no FAQ — the landing page
response even carries a `TODO(catalog)` marker where featured products and
categories belong.

This epic adds the commerce layer. It is split into seven specs so each can be a
branch of its own:

| # | Spec | Ships |
| --- | --- | --- |
| 1 | [categories.md](./categories.md) | `Category`, dashboard CRUD + reorder, storefront list |
| 2 | [product-attributes.md](./product-attributes.md) | `ProductAttribute`, `ProductAttributeValue`, variant axes vs descriptive, display styles |
| 3 | [products.md](./products.md) | `Product`, `ProductVariant`, `ProductImage`, dashboard CRUD, storefront list & detail, filter facets, ranked full-text search |
| 4 | [catalog-ai-setup.md](./catalog-ai-setup.md) | One Gemini generation proposing the store's categories **and** attributes |
| 5 | [faq.md](./faq.md) | `Faq`, dashboard CRUD + reorder, storefront list |
| 6 | [orders.md](./orders.md) | `Order`, `OrderItem`, checkout, status machine, dashboard views |
| 7 | [payments.md](./payments.md) | Payment provider port, card checkout + webhook, COD |

Read this file first — it holds every decision the seven share. The specs
themselves only state what is specific to them.

## What makes this different from "an e-commerce backend"

We are not building a store. We are building a **store builder**, and that
changes what needs CRUD:

- A normal shop hardcodes its categories. Here every store defines its own, so
  categories are owner-managed data.
- A normal shop hardcodes its product columns — a clothing shop's `products`
  table has `size` and `color`. Here it cannot, because the platform does not
  know what its stores sell. **The columns become rows**: each store declares
  its own attributes, and the platform ships only the ones every store shares
  (price, category, availability, search). This is the single biggest structural
  difference and it is why spec 2 exists.
- A normal shop writes its FAQ into the template. Here it is a table with an
  ordering column and a dashboard behind it.
- A normal shop has one landing page. Here the landing page is assembled from
  owner-curated *featured* products and categories.
- A normal shop's owner knows their own domain. Here many owners do not, so the
  platform proposes the whole scaffold from the questionnaire they already
  answered (spec 4).

Every one of these is store-scoped, and no store may ever see another's rows.

## Goals

- An owner can build a catalog: categories, attributes, products, images, stock,
  prices.
- An owner defines the filters *their* store needs, and a product sold in
  several sizes or colours has real per-combination price and stock.
- A storefront visitor can browse that catalog under `inventoai.com/SITENAME`,
  with both the built-in filters and the store's own facets.
- A store's registered customer can check out and pay.
- An owner can work their orders from the dashboard.
- An owner can write the store's FAQ.
- An owner who does not know what categories or filters their trade needs can
  have the platform propose them.
- The landing page finally gets its featured content, closing the catalog half
  of [TODO.md](../../TODO.md).

## Non-goals

Explicitly out of scope for this epic — each is its own later feature:

- **Storefront chatbot**, **Daily AI Advisor**, **smart inventory /
  forecasting**, **supplier purchasing ("Low Stock → Deal Closed")**.
- **AI anywhere except [catalog-ai-setup.md](./catalog-ai-setup.md).**
  `GeminiService` is injected in that spec and nowhere else in this epic. No AI
  writes a product, a price, an order or an FAQ.
- **Free-text product attributes.** Superseded — attributes are a controlled
  vocabulary with owner-defined values, spec 2.
- **Per-variant images**, so the gallery changes with the picker —
  [products.md](./products.md) Deferred.
- **Discounts, coupons, taxes, shipping-rate calculation.** An order carries a
  flat `shippingFee` the owner configures per store later; for now it is `0`.
- **Server-side cart** — see the decisions below.
- **Inventory event log.** Stock is a single number on the variant; the
  `InventoryEvent` history the forecasting module wants comes with that module.
- **Refund execution.** An order can be *marked* refunded; calling the provider's
  refund API is deferred.

## Shared decisions

### 1. The buyer is a store-scoped `User`

A storefront customer is a `User` row with `role = USER` and `storeId` set to the
store — exactly what [user-scoped-to-store](../fixes/user-scoped-to-store.md)
already built, including per-store registration, login, OTP verification and
password reset. `Order.userId` points at it.

No `Customer` entity, despite the draft domain model in
[project-overview.md](../project-overview.md). Adding one would mean a second
auth stack for the same person.

**Consequence: no guest checkout.** Placing an order requires a verified account
on that store. This is a real conversion cost and is called out in
[orders.md](./orders.md) as the first thing to revisit.

### 2. The cart lives in the client

There is no `Cart` entity. The storefront holds the cart (localStorage or its
own state) and checkout posts the line items. The backend **re-prices every line
from the database** and ignores any price in the request body — the client is
untrusted, so the cart's only job is remembering what was clicked.

### 3. Every product has variants

> A product **always** has at least one `ProductVariant`. A simple product has
> exactly one, flagged `isDefault`, with no attribute values attached. Price,
> `sku` and `stockQuantity` live on the variant, never on the product.

This replaces an earlier decision to skip variants entirely. That version forced
a choice between two bad models for a store selling one T-shirt in S/M/L: three
separate products, each duplicating the description and images, or one product
with a single shared stock number that cannot express "3 left in M". Both fail
the stores this platform targets.

Making the variant unconditional is what keeps the rest of the system from
forking. Checkout, the stock decrement, order snapshots and low-stock reporting
each have one code path rather than a simple-versus-variable branch — and that
branch is what makes variants miserable in codebases that bolt them on later.
The cost is one join on reads and one spare row for shops that never use it.

Which attributes create variants is not guessed. It is
`ProductAttribute.isVariantAxis`, declared per store in
[product-attributes.md](./product-attributes.md):

- **Variant axes** (Size, Colour) change SKU, price and stock; the shopper picks
  one before adding to cart.
- **Descriptive** attributes (Material, Brand, Author) describe the whole
  product; they filter and display but have no stock of their own.

**Why now.** Retrofitting variants after orders ship means migrating order
history and rewriting checkout against live data. `Product` and `Order` do not
exist yet, so this is the cheapest this change will ever be.

### 3a. Attributes are rows, not columns

The store-builder consequence, stated once here because three specs depend on
it: the platform cannot know whether a store needs `size`, `author` or
`horsepower`, so attribute *definitions* are per-store rows and product values
reference them by id.

Referencing by id rather than storing text is what makes "rename XL to Extra
Large" a single `UPDATE`, and what stops a sidebar rendering `XL`, `xl` and
`X-Large` as three separate filters that each match one product.

### 4. Money is stored in integer minor units

Every price, total and fee is an `int` column of minor units — piastres for EGP,
cents for USD. No `decimal`, no floats:

- TypeORM returns `decimal` columns as **strings**, which quietly turns
  arithmetic into concatenation.
- Floats cannot represent `0.1` and lose money over a sum of lines.

Currency lives on the store (see below), so a single `currency` field applies to
every amount in that store's rows. Formatting is the frontend's job — the API
returns `priceAmount: 24900` and `currency: "EGP"`, never a formatted string.

### 5. Multi-tenancy invariant

> Every query touching a commerce table filters by `storeId`, and `storeId`
> always comes from the authenticated caller or the URL slug — **never from the
> request body**.

Practical rules:

- Dashboard routes derive the store from the JWT. An `OWNER` carries
  `storeId: null`, so the store is resolved through `Store.ownerId`; an `ADMIN`
  carries `storeId` directly. This asymmetry is why a shared helper exists
  (below) instead of each service re-deriving it.
- Storefront routes derive the store from the `:slug` path segment.
- A DTO never declares a `storeId` field. `forbidNonWhitelisted` then rejects
  any attempt to send one with a 400.
- `PATCH`/`DELETE` by id always `WHERE id = :id AND storeId = :storeId`. A row
  belonging to another store must 404, never 403 — a 403 confirms the id exists.

### 6. Resolving the caller's store

Add to `StoreService`:

```ts
/** The store a dashboard caller acts on: OWNER via ownership, ADMIN via the JWT. */
async resolveCallerStore(user: JwtPayload): Promise<Store>
```

`OWNER` → `getByOwnerId(user.sub)`. `ADMIN`/`USER` → look up `user.storeId`,
404 if it is null or missing. Every dashboard service calls this once at the top
of a method and passes the id down. It ships with
[categories.md](./categories.md), the first spec to need it.

### 7. Route layout

| Surface | Prefix | Guards |
| --- | --- | --- |
| Dashboard | `/products`, `/categories`, `/orders`, `/faqs` | `JwtAuthGuard`, `RolesGuard` + `@Roles(OWNER, ADMIN)` |
| Storefront (public) | `/site/:slug/...` | none |
| Storefront (customer) | `/site/:slug/orders...` | `JwtAuthGuard`, `StoreScopeGuard` |

`StoreScopeGuard` already reads a `slug` or `storeSlug` param and rejects a token
issued for another store, so customer routes get tenant isolation for free.

`site` is already in `RESERVED_SLUGS`, so `/site/:slug/...` can never collide
with a store named "site".

### 8. Module layout

```
src/catalog/     Category, ProductAttribute, ProductAttributeValue,
                 Product, ProductVariant, ProductImage,
                 prompts/generate-catalog.prompt.ts
src/orders/      Order, OrderItem
src/payments/    PaymentProvider port, Paymob adapter, PaymentTransaction
src/faq/         Faq
```

One module for the whole catalog, as the categories branch already established.
Six entities is a lot for one module, but they are one domain — an attribute
with no products is not a feature, and splitting them would mean three modules
importing each other to validate a single product write.

Each follows the existing `site-builder` shape: `entities/`, `dto/`, `enums/`,
`*.constants.ts`, one service per entity, one controller per route prefix, and a
separate public controller for the storefront half.

### 9. Pagination contract

Every list endpoint is paginated the same way. Add to the common module:

- `src/common/dto/pagination-query.dto.ts` — `page` (default 1, min 1), `limit`
  (default 20, min 1, max 100), both `@Type(() => Number) @IsInt()`. Feature
  query DTOs extend it.
- `src/common/dto/paginated-response.dto.ts` —

  ```ts
  export class PaginatedResponseDto<T> {
    items!: T[];
    total!: number;
    page!: number;
    limit!: number;
    totalPages!: number;

    static of<T>(items: T[], total: number, query: PaginationQueryDto): PaginatedResponseDto<T>;
  }
  ```

Services return `[rows, total]` from `getManyAndCount()`; controllers map rows
through the feature's `fromEntity` and wrap with `PaginatedResponseDto.of`.

### 10. Soft delete

`Category`, `ProductAttribute`, `ProductAttributeValue`, `Product` and
`ProductVariant` all use TypeORM's `@DeleteDateColumn()`. A variant that appears
on an order can never be hard-deleted, and an owner who deletes something by
accident should not lose their order history's join target.

`OrderItem` additionally **snapshots** the title, price, image URL and the
variant's option combination at purchase time, so an order renders correctly
even after the product is deleted, repriced, or its attribute values renamed.
The snapshot is the source of truth for order display; `productId` and
`variantId` are only links back.

Every dashboard and storefront query uses the default TypeORM behaviour
(deleted rows excluded). No "restore from trash" UI in this epic.

### 11. Slugs

Categories and products carry a slug, unique per store, so URLs read
`/SITENAME/products/blue-ceramic-mug`. Reuse `slugify()` from
`src/site-builder/utils/slugify.util.ts` to derive a candidate from the title,
then de-duplicate with a numeric suffix (`blue-mug-2`) inside the same
transaction that inserts. The owner may override it with an explicit `slug`
field validated by `@IsSlug()`.

### 12. Image uploads

Cloudinary via the existing `CloudinaryService`, same shape as the hero upload
in `StoresController`: `FileInterceptor` + `ParseFilePipe` with
`MaxFileSizeValidator` and `FileTypeValidator`, a `*_SUBFOLDER` constant, and
`destroyImage(previousPublicId)` after a successful replace.

| Asset | Subfolder | Max size | Types |
| --- | --- | --- | --- |
| Product image | `products` | 5 MB | png, jpeg, webp |
| Category image | `categories` | 5 MB | png, jpeg, webp |

Every stored image keeps both `url` and `publicId` — without the public id the
asset can never be replaced or deleted.

### 13. Postgres extensions and the DDL `synchronize` cannot express

[products.md](./products.md) builds storefront search on Postgres full-text
search plus `pg_trgm`, which needs two things TypeORM cannot declare: extensions,
and `USING GIN` indexes. Both are confirmed present in the `postgres:15-alpine`
image the project already runs — `pg_trgm`, `btree_gin`, `unaccent` and
`fuzzystrmatch` are all available with no image change.

Until migrations land, that DDL runs from a module-owned `OnModuleInit`
initializer, every statement `IF NOT EXISTS`, failing soft with a log rather than
blocking boot if a managed host refuses `CREATE EXTENSION`. `CatalogSearchInitializer`
is the first of these.

Two rules for any spec that follows:

- **The initializer is a `synchronize`-era stopgap.** When migrations arrive, its
  statements become the first migration and the class is deleted. Label it as
  such in the code so it is not mistaken for architecture.
- **Idempotent or it does not ship.** It runs on every boot, in every
  environment, including a database that already has everything.

`vector` (pgvector) is the one notable extension the current image lacks; it
would need `pgvector/pgvector:pg15`. Nothing in this epic requires it — it is
noted for the chatbot's RAG later.

## Changes to existing code

These are shared by several specs; whichever branch lands first carries them.

### `Store` (site-builder)

| Column | Type | Why |
| --- | --- | --- |
| `currency` | `varchar(3)`, default `'EGP'` | The currency every amount in this store's rows is denominated in |
| `nextOrderNumber` | `int`, default `1` | Per-store human-readable order numbers |

### `StorePublicResponseDto`

Fill the `TODO(catalog)` marker with `featuredProducts` and `featuredCategories`,
and point `hero.ctaHref` at the products page by default once that route exists.
Caps: **8** featured products, **6** featured categories. Each is its own small
indexed select, not a join — one query fanning a store row out over fourteen
rows is worse than two.

`featuredCategories` shipped with branch 1, along with `currency`. The
composition lives in `SiteController`, **not** inside
`StoreService.resolvePublicStore` as first sketched: putting it in `StoreService`
would make `StoreService` ↔ `CategoryService` a provider-level cycle, whereas
composing in the controller keeps `forwardRef` at the module level. Follow the
same shape for `featuredProducts`.

### `TODO.md`

The "landing page is missing its featured content" section is closed by
[products.md](./products.md) and [categories.md](./categories.md) together.

## New environment variables

Only the payment spec adds any; they are listed in
[payments.md](./payments.md). The catalog, attribute, order and FAQ specs need
none — and [catalog-ai-setup.md](./catalog-ai-setup.md) reuses the already
validated `GEMINI_API_KEY` and `GEMINI_MODEL` rather than adding its own.

## Suggested implementation order

Each numbered item is its own branch, merged before the next starts.

1. **Categories** ✅ — smallest surface, and it introduced `resolveCallerStore`,
   the pagination DTOs, the reorder pattern, `buildUniqueSlug` and the
   `Store.currency` column that everything else builds on.
2. **Product attributes** — no dependency beyond the plumbing branch 1 landed.
   Must precede products, because product and variant writes validate against
   it.
3. **Products & variants** — the heaviest branch by a distance. Depends on 1 for
   the category relation and 2 for the axes. Consider splitting it if it grows:
   products + variants first, then the storefront filter facets, then search.
   Search is the natural seam — it touches one column, one initializer, one pure
   function and the public listing query, and nothing else in the branch depends
   on it.
4. **AI catalog setup** — depends only on 1 and 2, so it can be pulled forward
   or run in parallel with 3. Placed here because 3 is the critical path to
   orders and this is a leaf.
5. **FAQ** — independent of everything, tiny, and a good break between the heavy
   specs.
6. **Orders** — needs variants for pricing and stock, with COD only.
7. **Payments** — layers card checkout onto the order flow that already works.

Landing-page featured content lands in two halves: `featuredCategories` shipped
with 1, `featuredProducts` ships with 3.

## Testing

Same standard as the rest of the project: `npm run build` must pass, and the
endpoints are verified with an API client per
[ai-interactions.md](../ai-interactions.md). Unit tests are expected for the
pure helpers each spec introduces — those have no database and no excuse:

| Spec | Pure helpers that must be tested |
| --- | --- |
| 1 | `buildUniqueSlug` ✅ |
| 2 | reserved-key rejection, the `swatch`/`swatchHex` pairing |
| 3 | `buildOptionsKey`, `assertVariantMatrix`, `parseAttributeFilter`, `buildSearchQuery` |
| 4 | `sanitizeGeneratedCatalog` |
| 6 | `calculateTotals`, `assertTransition` |

The one cross-cutting test that must be run for **every** spec in this epic:

> Create two stores, A and B. Authenticate as A's owner. Attempt to read,
> update and delete each of B's rows by id. Every attempt must 404.

## Considered and rejected

- **One `src/products` module and one `src/categories` module.** The coding
  standard says one module per domain, and a category with no products is not a
  domain — it is a facet of the catalog. `site-builder` already sets the
  precedent of one module holding three related entities.
- **Free-form `jsonb` attributes on the product**, which is what this epic
  specified before spec 2 existed. It cannot produce per-value counts for a
  filter sidebar, and it lets one owner write `XL`, `xl` and `X-Large` into what
  is supposed to be one filter option. Filters built on unconstrained strings do
  not filter.
- **Skipping variants and modelling sizes as products.** See §3 — it forces a
  choice between duplicated products and un-trackable stock.
- **A generic `SerializerInterceptor` instead of `fromEntity` factories.** The
  project deliberately hand-maps responses so a `select: false` column can never
  leak. Introducing a serializer here would split the convention in two.
- **Postgres row-level security for tenant isolation.** Genuinely stronger than
  a `WHERE storeId = ...` convention, but it needs per-request session variables
  and a migration story, and the project still runs on `synchronize: true`.
  Revisit when migrations land.
