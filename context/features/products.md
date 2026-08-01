# Products & Variants

> Part of the [E-commerce Core](./ecommerce-core.md) epic. Shared decisions —
> tenant scoping, money as minor units, pagination, soft delete, slugs, image
> uploads — live there. Depends on [categories.md](./categories.md) and
> [product-attributes.md](./product-attributes.md).

## Overview

The catalog itself: what a store sells, at what price, and how much of it is
left. It is the largest surface in the epic because it feeds four consumers at
once — the dashboard's product manager, the storefront's listing and detail
pages, the filter sidebar, and the order module's pricing and stock checks.

## Goals

- An owner or admin can create, edit, publish, feature and delete products.
- A product can carry several images, ordered, with one primary.
- A product belongs to zero or more categories.
- A product sold in several sizes or colours has **real per-combination SKU,
  price and stock** — "3 left in M" is expressible.
- A product sold in exactly one form stays exactly as simple as it looks.
- The storefront can browse a store's published products with the built-in
  filters *and* the store's own attribute facets, each showing a live count.
- The order module has a single, trustworthy source for current price and stock.

## Non-goals

- **Owner-defined filters as free text.** Superseded — attributes are a
  controlled vocabulary, see [product-attributes.md](./product-attributes.md).
- **Demand forecasting, low-stock alerts, restock suggestions.** `stockQuantity`
  is a number, not an event log.
- **AI-written product descriptions.** No AI in this epic.
- **Digital products, bundles, subscriptions.**
- **Per-variant images** ("show the red one when Red is picked"). Images belong
  to the product in v1; the picker changes price and stock, not the gallery.
  Called out under Deferred as the first thing a clothing store will ask for.

## Every product has variants

The single decision this spec is built on:

> A product **always** has at least one `ProductVariant`. A simple product has
> exactly one, flagged `isDefault`, with no attribute values attached. It is
> created automatically and the dashboard never shows it.

Price, `sku` and `stockQuantity` therefore live on the **variant**, never on the
product, in every store — simple or not.

This is what keeps the rest of the system from branching. Checkout, stock
decrement, order snapshots and the low-stock report each have one code path
instead of a simple-versus-variable fork, and that fork is what makes variant
systems miserable in codebases that bolt them on later. The cost is one join on
reads and one extra row for shops that will never use it. That is a good trade.

## Auth & access control

| Surface | Rule |
| --- | --- |
| `/products/**` | `JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER, ADMIN)` |
| `/site/:slug/products/**` | public, no guard |
| `/site/:slug/filters` | public, no guard |

## Data model

### `Product` (new) — `src/catalog/entities/product.entity.ts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | `@BeforeInsert` `randomUUID()` |
| `storeId` | `uuid` | `@ManyToOne(() => Store, { onDelete: 'CASCADE' })` |
| `title` | `varchar` | 2–140 chars |
| `slug` | `varchar` | Unique per store, same de-duplication as categories |
| `description` | `text` nullable | Long copy for the detail page |
| `shortDescription` | `varchar(300)` nullable | Card copy for the listing |
| `status` | `enum ProductStatus` | `draft \| active \| archived` |
| `isFeatured` | `boolean`, default `false` | Landing page |
| `weightGrams` | `int` nullable | Reserved for shipping rules; not used yet |
| `position` | `int`, default `0` | Manual merchandising order |
| `minPriceAmount` | `int`, default `0` | **Derived** — cheapest live variant |
| `maxPriceAmount` | `int`, default `0` | **Derived** — dearest live variant |
| `totalStock` | `int`, default `0` | **Derived** — sum of variant stock |
| `variantCount` | `int`, default `0` | **Derived** — lets the client skip the picker |
| `createdAt` / `updatedAt` | timestamps | |
| `deletedAt` | `@DeleteDateColumn()` | Soft delete |

Relations:

```ts
@OneToMany(() => ProductVariant, (variant) => variant.product, { cascade: ['insert'] })
variants!: ProductVariant[];

@OneToMany(() => ProductImage, (image) => image.product, { cascade: ['insert'] })
images!: ProductImage[];

@ManyToMany(() => Category, (category) => category.products)
@JoinTable({ name: 'product_categories' })
categories!: Category[];

/** Descriptive attribute values only — axis values live on the variant. */
@ManyToMany(() => ProductAttributeValue)
@JoinTable({ name: 'product_attribute_values' })
attributeValues!: ProductAttributeValue[];
```

Indexes:

```ts
@Index('UQ_products_store_slug', ['storeId', 'slug'], {
  unique: true, where: '"deletedAt" IS NULL',
})
@Index('IDX_products_store_status', ['storeId', 'status'])
@Index('IDX_products_store_price', ['storeId', 'minPriceAmount'])
```

#### The four derived columns

`minPriceAmount`, `maxPriceAmount`, `totalStock` and `variantCount` are
denormalised from the variants. They exist because the storefront's hottest
query sorts and filters by price across pages, and an aggregate in `ORDER BY`
cannot use an index.

The rule that keeps them honest: **exactly one private method,
`recalculateAggregates(productId, manager)`, writes all four, and every code
path that touches a variant calls it inside the same transaction.** That is
create, update, delete, and the order module's stock decrement and restore.
Nowhere else may write them. Reviewed as a single point of failure rather than
scattered arithmetic.

`ProductStatus` (`src/catalog/enums/product-status.enum.ts`):

- `draft` — being written, invisible to the storefront.
- `active` — on sale.
- `archived` — discontinued, invisible, but kept for order history and
  reportable. Distinct from `deletedAt`, which means "the owner removed it".

### `ProductVariant` (new) — `src/catalog/entities/product-variant.entity.ts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `productId` | `uuid` | `@ManyToOne(() => Product, { onDelete: 'CASCADE' })` |
| `storeId` | `uuid` | Denormalised — every stock update is store-scoped |
| `sku` | `varchar` nullable | Owner's own code; unique per store when present |
| `priceAmount` | `int` | Minor units, `@Min(0)` |
| `compareAtAmount` | `int` nullable | The struck-through "was" price; must exceed `priceAmount` |
| `stockQuantity` | `int`, default `0` | Never negative — the decrement is conditional |
| `lowStockThreshold` | `int`, default `0` | Dashboard warning only |
| `optionsKey` | `varchar` | **Derived** — see below. `''` for a default variant |
| `isDefault` | `boolean`, default `false` | True only for the sole variant of a simple product |
| `position` | `int`, default `0` | Order in the picker |
| `createdAt` / `updatedAt` | timestamps | |
| `deletedAt` | `@DeleteDateColumn()` | Soft delete |

```ts
@ManyToMany(() => ProductAttributeValue)
@JoinTable({ name: 'variant_attribute_values' })
attributeValues!: ProductAttributeValue[];
```

Indexes:

```ts
@Index('UQ_variants_product_options', ['productId', 'optionsKey'], {
  unique: true, where: '"deletedAt" IS NULL',
})
@Index('UQ_variants_store_sku', ['storeId', 'sku'], {
  unique: true, where: '"deletedAt" IS NULL AND "sku" IS NOT NULL',
})
@Index('IDX_variants_product', ['productId'])
```

#### `optionsKey`

Two variants of one product must not carry the same combination — "Red / M"
twice is a bug that only shows up as a shopper adding the wrong row to their
cart. A unique index cannot span a join table, so the combination is
materialised: **the variant's attribute-value ids, sorted, joined with `:`**.

```
optionsKey = ['<red-id>', '<m-id>'].sort().join(':')
```

Sorted, so `Red/M` and `M/Red` collide as they must. Written by a pure function
in the same transaction as the join rows, and the unique index turns the race
between two dashboard tabs into a `23505` rather than a duplicate. A simple
product's default variant has `optionsKey = ''`, which the same index makes
unique — a product cannot have two defaults.

### `ProductImage` (new) — `src/catalog/entities/product-image.entity.ts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `productId` | `uuid` | `@ManyToOne(() => Product, { onDelete: 'CASCADE' })` |
| `url` | `varchar` | Cloudinary delivery URL |
| `publicId` | `varchar` | Required to destroy the asset |
| `position` | `int`, default `0` | `position = 0` is the primary image |
| `altText` | `varchar` nullable | Accessibility; owner-editable |
| `createdAt` | timestamp | |

A separate table rather than a jsonb array on `Product`, because images are
reordered and deleted individually and a jsonb array turns both into
read-modify-write races.

Max `MAX_PRODUCT_IMAGES = 8` per product, enforced in the service before upload
so a rejected batch never leaves orphaned Cloudinary assets.

### `Category` gains the inverse side

```ts
@ManyToMany(() => Product, (product) => product.categories)
products!: Product[];
```

A product belongs to **many** categories (a mug is in "Kitchen" and "Gifts").
This is also where `CategoryResponseDto.productCount` and
`CategoryPublicDto.productCount` are finally filled — the categories branch left
them out rather than hardcode a `0`.

## Endpoints

### Dashboard

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/products` | `CreateProductDto` | `ProductResponseDto` (201) |
| `GET` | `/products` | query `ProductQueryDto` | `PaginatedResponseDto<ProductListItemDto>` |
| `GET` | `/products/:id` | — | `ProductResponseDto` |
| `PATCH` | `/products/:id` | `UpdateProductDto` | `ProductResponseDto` |
| `DELETE` | `/products/:id` | — | `MessageResponseDto` |
| `PATCH` | `/products/reorder` | `ReorderProductsDto` | `MessageResponseDto` |
| `POST` | `/products/:id/variants` | `CreateVariantDto` | `ProductResponseDto` |
| `PATCH` | `/products/:id/variants/:variantId` | `UpdateVariantDto` | `ProductResponseDto` |
| `DELETE` | `/products/:id/variants/:variantId` | — | `ProductResponseDto` |
| `POST` | `/products/:id/variants/generate` | `GenerateVariantsDto` | `ProductResponseDto` |
| `POST` | `/products/:id/images` | multipart `images` (1–8 files) | `ProductResponseDto` |
| `PATCH` | `/products/:id/images/reorder` | `ReorderImagesDto` | `ProductResponseDto` |
| `PATCH` | `/products/:id/images/:imageId` | `UpdateImageDto` (`altText`) | `ProductResponseDto` |
| `DELETE` | `/products/:id/images/:imageId` | — | `ProductResponseDto` |

`reorder` and `generate` are declared before their `:id`/`:variantId` siblings,
as in categories.

`POST /products/:id/variants/generate` is the matrix builder: the body names the
axes and the values to use, and the server produces the cross product, skipping
combinations that already exist.

```json
{
  "axes": [
    { "attributeId": "<size>", "valueIds": ["<s>", "<m>", "<l>"] },
    { "attributeId": "<color>", "valueIds": ["<red>", "<blue>"] }
  ],
  "priceAmount": 24900,
  "stockQuantity": 0
}
```

Six variants, all at the same starting price and stock, which the owner then
edits individually. Without this route the dashboard has to issue six creates
and reconcile partial failures; with it, one transaction succeeds or none does.

Dashboard list filters: `search` (title or variant sku, `ILIKE`), `status`,
`categoryId`, `isFeatured`, `lowStock` (any variant at or below its threshold),
plus `sort` (`createdAt|title|minPriceAmount|totalStock`) and `order`.

### Storefront

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/site/:slug/products` | `PaginatedResponseDto<ProductPublicListItemDto>` |
| `GET` | `/site/:slug/products/:productSlug` | `ProductPublicDto` |
| `GET` | `/site/:slug/filters` | `StoreFiltersDto` |

Storefront query (`PublicProductQueryDto`, extends `PaginationQueryDto`):

| Param | Effect |
| --- | --- |
| `category` | Category **slug** — `?category=kitchen` |
| `search` | `ILIKE` over title and short description |
| `minPrice` / `maxPrice` | Minor units, inclusive, against `minPriceAmount` |
| `inStock` | `true` → `totalStock > 0` |
| `attributes` | The store's own facets — see below |
| `sort` | `newest` (default) \| `price_asc` \| `price_desc` \| `title` |

Every storefront query is hard-filtered by `store.status = live`,
`product.status = active` and `deletedAt IS NULL`. A `draft` product must be
unreachable by direct slug, not merely absent from the list — the detail route
404s on it.

## Custom facets in the query string

This is the part that does not fall out of the existing conventions, and getting
it wrong costs a day.

The global `ValidationPipe` runs `forbidNonWhitelisted: true`. A DTO cannot
declare a `size` field, because `size` is a row in another store's database, not
a property of any class. So `?size=xl` would be rejected with **400 property
size should not exist** — the platform's own safety setting turning every custom
filter into an error.

The fix is one whitelisted parameter carrying a small grammar:

```
?attributes=size:xl,l;color:red
              │   │  │   └── another facet, ';' separated
              │   │  └────── another value, ',' separated (OR within a facet)
              │   └───────── value slugs
              └───────────── attribute key
```

Semantics: **OR within a facet, AND across facets.** `size:xl,l;color:red` means
"(XL or L) and Red", which is what every shopper means and what every commerce
site does.

Parsing is a pure function, `parseAttributeFilter(raw): Map<string, string[]>`,
with a hard cap of `MAX_FILTER_FACETS` keys and `MAX_FILTER_VALUES_PER_FACET`
values — it is a public, unauthenticated endpoint and the string is attacker
controlled.

Every parsed key is then resolved against the store's `ProductAttribute` rows.
**An unknown key or value is ignored, not rejected.** A 400 would be better for
debugging, but these URLs get bookmarked and shared, and an owner deleting a
value would turn every shared link into an error page. Silently narrowing to the
filters that still exist is the behaviour a storefront needs.

Translating to SQL depends on which kind the attribute is, which is exactly what
`isVariantAxis` records:

- **axis** → `EXISTS (variant of this product, not deleted, joined to
  variant_attribute_values, whose valueId is in this facet's set)`
- **descriptive** → `EXISTS (row in product_attribute_values for this product
  with a valueId in the set)`

One `EXISTS` per facet, AND-ed. Each is an indexed lookup on the join table's
`(attributeValueId)` column, and `EXISTS` short-circuits — this stays cheap as
facets multiply, which a `JOIN` plus `GROUP BY ... HAVING COUNT` would not.

## `GET /site/:slug/filters`

What the sidebar renders itself from. It takes **the same query parameters as
the product listing**, because the counts must reflect the filters already
applied.

```json
{
  "price": { "min": 4900, "max": 129900 },
  "categories": [{ "name": "Kitchen", "slug": "kitchen", "count": 24 }],
  "attributes": [
    {
      "key": "size", "name": "Size", "displayStyle": "chip", "isVariantAxis": true,
      "values": [
        { "slug": "s", "value": "S", "swatchHex": null, "count": 12 },
        { "slug": "m", "value": "M", "swatchHex": null, "count": 0 }
      ]
    },
    {
      "key": "colour", "name": "Colour", "displayStyle": "swatch", "isVariantAxis": true,
      "values": [
        { "slug": "red", "value": "Red", "swatchHex": "#e11d48", "count": 7 }
      ]
    }
  ]
}
```

`displayStyle` and `swatchHex` come straight through so the sidebar renders
without inspecting the attribute's name — `swatch` as coloured circles, `chip`
as neutral circles with the text inside. The full table is the rendering
contract in [product-attributes.md](./product-attributes.md).

Two rules that make a filter sidebar usable rather than infuriating:

1. **A facet's own selection is excluded from its own counts.** Having picked
   Red, the Colour counts still show how many Blue items there are — otherwise
   every other colour reads `0` and the shopper cannot switch. Every *other*
   facet's selection does apply. This is standard faceted-search behaviour and
   it is the reason this is not one query.
2. **A value with a count of `0` is returned, not omitted**, and the frontend
   renders it disabled. Options that vanish as you click make a sidebar feel
   broken.

Implementation: one count query per filterable attribute, each with the other
facets' predicates applied. With `MAX_ATTRIBUTES_PER_STORE = 20` and typically
three or four filterable, that is a handful of indexed counts. If it ever shows
up in a profile, the upgrade is a single grouped query over the join table —
noted, not built.

## DTOs — `src/catalog/dto/`

`create-product.dto.ts`, `update-product.dto.ts`, `create-variant.dto.ts`,
`update-variant.dto.ts`, `generate-variants.dto.ts`, `product-query.dto.ts`,
`public-product-query.dto.ts`, `reorder-products.dto.ts`,
`reorder-images.dto.ts`, `update-image.dto.ts`, `product-response.dto.ts`,
`product-list-item.dto.ts`, `product-public.dto.ts`,
`product-public-list-item.dto.ts`, `variant-response.dto.ts`,
`variant-public.dto.ts`, `store-filters.dto.ts`.

`CreateProductDto`:

```ts
{
  title: string;
  slug?: string;
  description?: string;
  shortDescription?: string;
  status?: ProductStatus;
  isFeatured?: boolean;
  categoryIds?: string[];        // ≤ MAX_PRODUCT_CATEGORIES
  attributeValueIds?: string[];  // descriptive only, ≤ MAX_PRODUCT_ATTRIBUTE_VALUES
  variants: CreateVariantDto[];  // required, ≥ 1
}
```

A simple product sends one variant with no `attributeValueIds`:

```json
{ "title": "Blue Mug", "variants": [{ "priceAmount": 24900, "stockQuantity": 40 }] }
```

Verbose for the simple case, and deliberately so — one shape, one code path. The
dashboard hides the array behind a plain price/stock form when the owner has not
chosen any axes.

Notes on validation:

- `priceAmount` — `@IsInt() @Min(0) @Max(MAX_PRICE_AMOUNT)`. Integer minor units;
  a decimal in the body is a 400. Document it loudly for the frontend:
  **`24900` means 249.00 EGP**.
- `compareAtAmount` — nullable, rejected when `<= priceAmount`. A "was" price
  below the current price is a lie, not a discount.
- `categoryIds` — `@IsUUID('4', { each: true })`, `@ArrayMaxSize(10)`. Every id
  verified to belong to the caller's store before the join rows are written; a
  foreign id is a 400 naming the field, not a silent drop.
- `attributeValueIds` — same store check, **plus** a kind check: a value whose
  attribute is a variant axis is a 400 at product level, and a descriptive value
  is a 400 inside a variant. Putting Size on the product instead of the variant
  is the single most likely client mistake, and it must not be accepted quietly.
- `slug` — optional `@IsSlug()`, otherwise derived from `title`.

## Behaviour

### The variant matrix is validated as a whole

Before anything is written, one pure function checks the submitted variants:

1. Every `attributeValueId` exists, belongs to this store, and its attribute is
   `isVariantAxis`.
2. **Every variant uses the same set of axes.** A product cannot have one
   variant keyed by Size and another by Size + Colour — the picker has no way to
   render it and `optionsKey` would compare across different shapes.
3. No two variants share an `optionsKey`.
4. At most `MAX_VARIANT_AXES_PER_PRODUCT` axes and
   `MAX_VARIANTS_PER_PRODUCT` variants — three axes of ten values each is a
   thousand rows from one request.
5. Exactly one variant with no axes is allowed, and only when it is the only
   variant — that is the simple-product case, and it gets `isDefault = true`.

`assertVariantMatrix(input)` throws a `BadRequestException` naming the offending
combination. It takes no repository and is the highest-value unit test in this
spec.

### Pricing is server-side, always

The only place a price is read for an order is `ProductVariant.priceAmount` at
the moment of checkout. Nothing in the order flow accepts a price from a client.
See [orders.md](./orders.md).

### Stock

`stockQuantity` is edited directly by the owner and decremented by the order
module through a conditional update — now against the variant:

```sql
UPDATE product_variants SET "stockQuantity" = "stockQuantity" - :qty
WHERE id = :variantId AND "storeId" = :storeId AND "stockQuantity" >= :qty
```

If the update affects zero rows the variant is out of stock and the whole
checkout transaction rolls back. That is why the column can never go negative
and why no lock is needed. The order module then calls
`recalculateAggregates` for the parent product in the same transaction, so
`totalStock` never drifts from its variants.

### Deleting

Soft delete, product and variant alike. The variant row stays as the join target
for `OrderItem.variantId`, whose snapshot means the order renders correctly
regardless. Images are left on Cloudinary for the same reason categories' are.

**Deleting the last live variant of a product is a 400.** A product with no
variants has no price and no stock; it is not a product. The owner archives the
product instead, which is what they meant.

Archiving (`status = archived`) is the softer alternative the dashboard should
suggest first: it hides the product from customers while keeping it in reports.

### Closing the attributes stub

[product-attributes.md](./product-attributes.md) ships `countProductsUsing()`
returning `0` with a `TODO(products)`. This branch implements it against both
join tables, which turns on the 409 that stops an owner deleting a value that
12 products still use.

## Constants — added to `src/catalog/catalog.constants.ts`

```ts
export const PRODUCT_TITLE_MIN_LENGTH = 2;
export const PRODUCT_TITLE_MAX_LENGTH = 140;
export const PRODUCT_SHORT_DESCRIPTION_MAX_LENGTH = 300;
export const PRODUCT_DESCRIPTION_MAX_LENGTH = 5000;
export const PRODUCT_SUBFOLDER = 'products';
export const PRODUCT_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_MIME_TYPE_PATTERN = /^image\/(png|jpeg|webp)$/;
export const MAX_PRODUCT_IMAGES = 8;
export const MAX_PRODUCT_CATEGORIES = 10;
export const MAX_PRODUCT_ATTRIBUTE_VALUES = 30;

export const MAX_VARIANT_AXES_PER_PRODUCT = 3;
export const MAX_VARIANTS_PER_PRODUCT = 100;

export const MAX_FILTER_FACETS = 10;
export const MAX_FILTER_VALUES_PER_FACET = 20;

/** 100,000,000 minor units = 1,000,000.00 — a sane ceiling, not a business rule. */
export const MAX_PRICE_AMOUNT = 100_000_000;
export const MAX_FEATURED_PRODUCTS = 8;
export const PUBLIC_STOCK_HINT_THRESHOLD = 5;
```

## What the storefront sees

`ProductPublicListItemDto` — a card: title, slug, primary image, categories,
`minPriceAmount`/`maxPriceAmount` (equal for a simple product, so the client
renders "249.00" or "from 249.00" without a flag), `inStock`, and the swatch
values of any `swatch`-styled axis so the listing can preview colours.

`ProductPublicDto` — the detail page: the product, its ordered images, its
published categories, its descriptive attributes grouped for the spec table, and
its variants, each with `id`, `priceAmount`, `compareAtAmount`, `inStock`, and
the attribute values that define it. The frontend builds the picker from that
array; the backend does not model "which combinations are valid" beyond what
exists.

Stock is exposed **only** as a capped hint (`"stockLeft": 3` when at or below
`PUBLIC_STOCK_HINT_THRESHOLD`, else `null`), per variant. Publishing exact
inventory to the internet tells competitors your sales rate.

## Landing page

This spec closes the other half of the `TODO(catalog)` marker:

- `featuredProducts` on `StorePublicResponseDto` — up to
  `MAX_FEATURED_PRODUCTS`, `isFeatured = true`, `status = active`, ordered by
  `position ASC, createdAt DESC`, each mapped through
  `ProductPublicListItemDto`.
- `hero.ctaHref` defaults to `/{slug}/products` instead of `null`.

Assembled in `SiteController` alongside `featuredCategories`, the shape the
categories branch already established.

## Implementation order

1. `ProductStatus` enum; `Product`, `ProductVariant`, `ProductImage` entities;
   the `product_categories`, `product_attribute_values` and
   `variant_attribute_values` join tables; indexes.
2. The pure helpers first, driven by unit tests: `buildOptionsKey`,
   `assertVariantMatrix`, `parseAttributeFilter`.
3. `ProductService.create` with the matrix validation and
   `recalculateAggregates`. Do this before any controller exists.
4. DTOs and `ProductsController` — CRUD, then the variant routes, then
   `generate`.
5. Image routes: upload, reorder, alt text, delete.
6. `PublicProductsController` — listing with built-in filters, then the
   `attributes` grammar, then detail by slug.
7. `GET /site/:slug/filters` with counts.
8. `featuredProducts` + `hero.ctaHref`; `productCount` on both category DTOs;
   close the `countProductsUsing` stub.

## Tests

Unit (pure, no database — these carry the spec):

- `buildOptionsKey` — order-independent, stable, `''` for no options.
- `assertVariantMatrix` — duplicate combination rejected; mismatched axes across
  variants rejected; a descriptive value used as an axis rejected; a bare
  variant alongside others rejected; a lone bare variant accepted; the caps
  enforced.
- `parseAttributeFilter` — `size:xl,l;color:red` parses; malformed input yields
  an empty map rather than throwing; caps truncate; duplicate keys merge.
- Query-builder composition: a `PublicProductQueryDto` with every filter set
  produces the expected where-clauses. Extract the builder so it is testable
  without a database.
- `compareAtAmount <= priceAmount` is rejected.

Endpoint checks:

- Simple product: one variant, no axes → `minPriceAmount == maxPriceAmount`,
  `variantCount == 1`, and the storefront card shows a single price.
- `generate` with Size(3) × Colour(2) → six variants, six distinct
  `optionsKey`s, `variantCount == 6`; running it again adds nothing.
- Editing one variant's price updates the product's `minPriceAmount`.
- Deleting the last variant → 400; deleting one of six → aggregates recomputed.
- Create with `categoryIds` from another store → 400, no join rows written.
- Size (an axis) sent in the product-level `attributeValueIds` → 400.
- `draft` product by slug on the storefront → 404. Set `active` → 200.
- `archived` product → absent from the storefront, present in the dashboard list.
- `?attributes=size:xl` returns only products with a live XL variant.
- `?attributes=size:xl,l` returns the union; `?attributes=size:xl;color:red`
  returns the intersection.
- `?attributes=nonsense:whatever` is ignored and returns the unfiltered page.
- `?size=xl` (the naive form) → 400, and the spec's grammar is the documented
  fix. Assert this, because it is the mistake the frontend will make first.
- `/filters` counts: picking Red keeps the other colours' counts non-zero, and
  narrows the Size counts.
- Price filter boundaries: `minPrice` equal to a product's price includes it.
- `category=<slug>` returns only that category's products; an unknown slug
  returns an empty page, not a 404.
- Sort by `price_asc` orders correctly across pages.
- 9 images → 400 before any upload happens; 8 → all stored with positions 0–7.
- Delete image → gone from the response, Cloudinary asset destroyed.
- Product of store B by id from store A's owner → 404 on every verb.
- `stockQuantity` cannot be set negative directly (400).
- Deleting an attribute value used by a product → 409 naming the count.
- Soft-deleted product still renders on an existing order (cross-check with
  [orders.md](./orders.md)).

## Considered and rejected

- **Price and stock on `Product`, with variants as an optional extra.** The
  version this spec replaced. Every consumer — checkout, stock, orders,
  low-stock reporting — would need a "does this product have variants?" branch,
  and the two paths drift. One always-present variant costs a row and removes
  the fork.
- **A separate `SimpleProduct` and `VariableProduct`.** The same fork, promoted
  to the type system, where it is harder to remove.
- **Computing `minPriceAmount` on read instead of storing it.** Correct by
  construction and no denormalisation to keep honest — but it puts an aggregate
  in the `ORDER BY` of the storefront's main paginated query, which no index can
  serve. Stored, with a single writer, is the trade.
- **Free-form `jsonb` attributes on the product.** See
  [product-attributes.md](./product-attributes.md).
- **`?size=xl` as a direct query parameter.** Impossible under
  `forbidNonWhitelisted` without disabling it globally, and disabling it would
  remove the protection that makes "no `storeId` in a body" enforceable.
- **One category per product (`ManyToOne`).** An e-commerce *builder* cannot
  predict how an owner organises their catalog, and every store eventually wants
  a product in both "Sale" and its real category.
- **`jsonb` array of images on `Product`.** Per-image delete and reorder become
  read-modify-write cycles that two dashboard tabs can race.
- **`decimal(10,2)` for prices.** TypeORM hands `decimal` back as a string, so
  every sum needs a parse and one missed parse is a concatenated total.
- **Exposing `stockQuantity` publicly.** It publishes the store's sales rate to
  anyone who polls it. The capped hint gives shoppers urgency without the leak.

## Deferred

- **Per-variant images** — the picker changing the gallery. The first thing a
  clothing store asks for; needs `ProductImage.variantId` nullable and a
  fallback rule.
- Bulk import/export (CSV), which every real owner will eventually ask for.
- Full-text search — `ILIKE` is fine for a few thousand rows per store; Postgres
  `tsvector` or a search service comes with scale.
- Inventory event log feeding the forecasting module.
- Range and numeric facets (`weight between 1–5 kg`).
- A single grouped query for facet counts, if the per-attribute counts profile
  badly.
