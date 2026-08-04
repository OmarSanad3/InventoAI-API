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
- **A shopper can search the catalog and get ranked, stemmed, typo-tolerant
  results with as-you-type suggestions** — the search quality people associate
  with Elasticsearch, built on Postgres. See [Search](#search).
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
| `searchKeywords` | `varchar(200)` nullable | Owner-supplied synonyms — see [Search](#search) |
| `searchVector` | `tsvector`, `select: false` | **Generated** — see [Search](#search) |
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

The two **GIN** indexes search needs cannot be declared here — TypeORM's `@Index`
has no `USING` option — so they are created as raw DDL by the bootstrap in
[Search](#search).

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

Dashboard list filters: `search` (full-text over the product, or a prefix match
on a variant sku — see [Search](#search)), `status`, `categoryId`, `isFeatured`,
`lowStock` (any variant at or below its threshold), plus `sort`
(`createdAt|title|minPriceAmount|totalStock`) and `order`.

### Storefront

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/site/:slug/products` | `ProductSearchResponseDto` |
| `GET` | `/site/:slug/products/suggest` | `ProductSuggestionDto[]` |
| `GET` | `/site/:slug/products/:productSlug` | `ProductPublicDto` |
| `GET` | `/site/:slug/filters` | `StoreFiltersDto` |

`suggest` is declared **before** `:productSlug`, or it resolves as a product
slug — the same ordering rule `reorder` and `generate` follow on the dashboard.

Storefront query (`PublicProductQueryDto`, extends `PaginationQueryDto`):

| Param | Effect |
| --- | --- |
| `category` | Category **slug** — `?category=kitchen` |
| `search` | Ranked full-text with prefix and typo fallback — see [Search](#search) |
| `minPrice` / `maxPrice` | Minor units, inclusive, against `minPriceAmount` |
| `inStock` | `true` → `totalStock > 0` |
| `attributes` | The store's own facets — see below |
| `sort` | `relevance` \| `newest` \| `price_asc` \| `price_desc` \| `title` |

`sort` defaults to `relevance` when `search` is present and `newest` otherwise;
`relevance` without a `search` degrades to `newest` rather than 400.

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

## Search

Search is a headline feature of the storefront, not a `WHERE title LIKE` clause.
The target is what shoppers expect from a search box: results ordered by
relevance, `running shoes` matching "Running Shoe", a typo still finding the
product, and a suggestion dropdown that fills in as they type.

All of it is **Postgres**. No Elasticsearch, no second datastore, no indexing
pipeline to keep in sync — two contrib extensions that ship with the
`postgres:15-alpine` image already in [docker-compose.yml](../../docker-compose.yml):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram similarity → typo tolerance
CREATE EXTENSION IF NOT EXISTS btree_gin;  -- lets storeId share the GIN index
```

Three mechanisms, each doing the job it is actually good at:

| Mechanism | Postgres tool | Handles |
| --- | --- | --- |
| Ranked full-text | `tsvector` / `to_tsquery` / `ts_rank_cd` | word matching, stemming, weighting, relevance order |
| Prefix match | `:*` on the final lexeme | as-you-type, before the word is finished |
| Fuzzy fallback | `pg_trgm` `word_similarity` | typos, only when full-text finds nothing |

### The `searchVector` column

A **generated, stored** column, so Postgres maintains it on every write. No
application code, no sync job, no way for the index to drift from the row:

```ts
@Column({
  type: 'tsvector',
  select: false,
  asExpression: `
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce("searchKeywords", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("shortDescription", '')), 'C') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'D')
  `,
  generatedType: 'STORED',
})
searchVector!: string;
```

`select: false` for the same reason `User.password` has it — it is machinery, and
it must never reach a response DTO.

**The weights are the ranking.** A product whose *title* is "Popcorn Machine"
must outrank one that merely mentions popcorn in paragraph four of its
description, and the `A`/`B`/`C`/`D` labels are what tell `ts_rank_cd` so.
Measured on the real container, title vs description for the same term:

```
ts_rank_cd(<title match>,       to_tsquery('english','popcorn'), 32) = 0.5000
ts_rank_cd(<description match>, to_tsquery('english','popcorn'), 32) = 0.0909
```

Normalisation flag `32` divides by `rank + 1`, so the score lands in `0..1` and
is comparable across queries — useful later for "is this result good enough to
show at all".

### `searchKeywords` — weight B, and worth the column

A `varchar(200)` the owner fills with words shoppers use that the product copy
does not: `sneakers, trainers, kicks`, or the Arabic name of an
English-titled product. It sits at weight `B`, just under the title.

This is the store-builder answer to synonyms. The alternative is a platform-wide
synonym dictionary, which cannot work here — the platform does not know whether
a store sells shoes or ceramics. One nullable column lets each owner fix their
own store's vocabulary, and it is the field the AI catalog setup can propose
later.

> Deliberate addition beyond the original spec. It is one nullable column and one
> optional DTO field; cut it and nothing else in this section changes.

### The indexes

TypeORM cannot express `USING GIN`, so these are raw DDL:

```sql
CREATE INDEX IF NOT EXISTS "IDX_products_search"
  ON products USING GIN ("storeId", "searchVector");

CREATE INDEX IF NOT EXISTS "IDX_products_title_trgm"
  ON products USING GIN (title gin_trgm_ops);
```

The first is why `btree_gin` is installed: it puts `storeId` **inside** the GIN
index, so a store's search is one index scan rather than a full-text scan
bitmap-ANDed against a tenant filter. Multi-tenant search is the whole workload
here, so the tenant belongs in the index.

### Where the DDL runs

There are no migrations yet — dev builds the schema from `synchronize: true` —
and `synchronize` creates neither extensions nor GIN indexes. So the catalog
module owns a small idempotent bootstrap:

```ts
/** Creates the search extensions and GIN indexes synchronize cannot express. */
@Injectable()
export class CatalogSearchInitializer implements OnModuleInit { … }
```

Every statement is `IF NOT EXISTS`, so it is safe on every boot. It logs and
continues rather than throwing if `CREATE EXTENSION` is refused — on a managed
Postgres that lacks the privilege the app must still start, with search
degraded, not dead. **When migrations land this moves into one and the
initializer is deleted**; it is a `synchronize`-era stopgap and should be
labelled as one in the code.

### Turning a shopper's typing into a `tsquery`

`to_tsquery` takes an *operator expression*, not prose — it throws `42601` on
anything malformed, and `&`, `|`, `!`, `(`, `)`, `:`, `*` are all syntax. A raw
query string reaching it is a guaranteed 500 on the first shopper who types
`t-shirt (red)`.

One pure function owns this, and it is the highest-value unit test in the
section:

```ts
export function buildSearchQuery(raw: string): SearchQuery | null;

interface SearchQuery {
  /** Safe to interpolate into to_tsquery. */
  readonly tsquery: string;
  /** The trimmed original, for the trigram fallback and did-you-mean. */
  readonly term: string;
}
```

Rules, in order:

1. Trim; give up (`null`) on empty — an absent search is not a filter.
2. Truncate to `SEARCH_QUERY_MAX_LENGTH`. Public, unauthenticated, attacker-controlled.
3. Strip every `tsquery` operator character and quote. Not escape — **strip**.
   There is no legitimate shopper query containing `!`, and a stripped string
   cannot be malformed.
4. Split on whitespace, drop empties, keep at most `SEARCH_MAX_TOKENS`.
5. Join with ` & ` — **AND**, so more words narrow the result rather than
   flooding it. `red mug` means both.
6. Append `:*` to the **last token only**, so a half-typed final word still
   matches while the completed words stay exact.

```
"red popco"  →  'red & popco:*'
"t-shirt (red)"  →  'tshirt & red:*'
"  !!!  "  →  null
```

Verified on the container: `to_tsvector('english','Popcorn Machine') @@
to_tsquery('english','popco:*')` is true, and `'run'` matches "Running Shoes"
through the stemmer.

### Ranking and sort

A new `sort` value, `relevance`, scoring `ts_rank_cd("searchVector", :query, 32)`
descending, with `createdAt DESC` as the tie-break so equal scores are at least
stable across pages.

Two rules the frontend does not have to think about:

- **`search` present and no explicit `sort` → `relevance`.** Anything else is
  the wrong default; a shopper who searched wants the best match first, not the
  newest product.
- **`sort=relevance` with no `search` → silently falls back to `newest`.** Not a
  400. Search URLs get shared and bookmarked, and the shopper who clears the
  search box must not land on an error page. Same philosophy as an unknown facet
  key being ignored.

### Typo tolerance, as a fallback rather than a mode

Full-text search does **not** find `popcorm`. Stemming is not spell-checking.
That is what `pg_trgm` is for, and the sequencing matters:

1. Run the full-text query. If it returns anything, return it. **`searchMode: "exact"`.**
2. Only if it returned **zero** rows, run the trigram query. **`searchMode: "fuzzy"`**,
   and `didYouMean` carries the best-matching title so the storefront can print
   *Showing results for "popcorn machine"*.

The fuzzy pass is one extra query, and only on a search that already failed —
zero cost on the common path.

**Use `word_similarity` / `<%`, not `similarity` / `%`.** This is the trap, and
it was measured rather than assumed. `similarity()` compares the query against
the *whole* title, so a long title drowns a short query:

```
similarity     ('Deluxe Stainless Steel Popcorn Machine for Home Parties', 'popcorm') = 0.109  → miss
word_similarity('popcorm', 'Deluxe Stainless Steel Popcorn Machine for Home Parties') = 0.750  → hit
```

`word_similarity` scores the query against the best-matching run of words inside
the target, which is what a product title needs. Note the **argument order is
reversed** between the two functions, and `<%` reads *"the left string has a
similar word in the right string"* — easy to write backwards, so assert it in a
test. The default `pg_trgm.word_similarity_threshold` is `0.6`; the spec pins
`SEARCH_WORD_SIMILARITY_THRESHOLD` explicitly rather than depending on a
server-level GUC that a managed host might set differently.

### Arabic

The platform targets Egypt and MENA, so this is not a footnote.

A generated column must be `IMMUTABLE`, which means the text-search config has to
be a **literal** — `'english'`, not `Store.locale`. Postgres also ships no Arabic
dictionary. So Arabic titles get no stemming and no stopword removal.

They are still fully searchable. Verified:

```
to_tsvector('english','قميص قطن أحمر للأطفال')
  → 'أحمر':3 'قطن':2 'قميص':1 'للأطفال':4
word_similarity('قميص قطن', 'قميص قطن أحمر') = 0.615
```

The parser tokenises Arabic correctly, so exact and prefix matching work
normally; only the morphological folding is missing. Trigram is entirely
language-agnostic and picks up much of that slack — which is a second reason the
fuzzy fallback is not optional here, and why an Arabic-heavy store leans on it
more than an English one.

The upgrade, when it matters, is a per-store config — which means replacing the
generated column with a trigger, because a trigger *can* read `Store.locale`.
Recorded under Deferred; not worth the loss of "Postgres maintains it for free"
until a store complains.

### Dashboard search is a different problem

`GET /products?search=` searches for **an owner looking for a known row**, not a
shopper discovering one. It matches:

- the product's `searchVector` (same query, same stemming), **OR**
- `variant.sku ILIKE :term || '%'` — a prefix `EXISTS` on the variants.

SKUs are codes, not prose. Stemming `TSHIRT-RED-XL` is meaningless and
tokenising it is worse; a prefix `ILIKE` on a short, indexed, store-scoped set is
exactly right. No fuzzy fallback and no relevance sort here — the dashboard's
sort belongs to the owner, who is usually sorting by stock or date.

### `GET /site/:slug/products/suggest`

The autocomplete dropdown. Same `tsquery`, but the cheapest possible select —
`id`, `title`, `slug`, primary image, `minPriceAmount` — capped at
`SEARCH_SUGGEST_LIMIT` and never paginated.

Declared **before** `:productSlug` in the controller, or `suggest` resolves as a
product slug. Same ordering rule as `reorder` and `generate`.

It carries no fuzzy fallback: it fires on every debounced keystroke, and an
empty dropdown mid-word is the correct, quiet answer. The fallback belongs on
the deliberate, submitted search.

> Deliberate addition beyond the original spec, same as `searchKeywords`. It is
> the visible half of "good search" — cut it and the rest of this section is
> unaffected.

### What the frontend must do

- **Debounce** at ~300 ms. It cuts a typed word from ~8 requests to 1, and it
  matters more at this catalog size than any index does.
- **Do not fire under `SEARCH_MIN_QUERY_LENGTH` (2).** A one-character prefix
  matches nearly the whole catalog and is the most expensive query available.
- Send `sort` only when the shopper picks one, so the `relevance` default applies.

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
`variant-public.dto.ts`, `store-filters.dto.ts`,
`product-search-response.dto.ts`, `product-suggestion.dto.ts`.

`ProductSearchResponseDto` extends `PaginatedResponseDto<ProductPublicListItemDto>`
with the two fields the search box needs — `PaginatedResponseDto` itself is
shared plumbing and stays untouched:

```ts
{
  searchMode: 'exact' | 'fuzzy' | null;  // null when no search was sent
  didYouMean: string | null;             // set only when searchMode is 'fuzzy'
}
```

`CreateProductDto`:

```ts
{
  title: string;
  slug?: string;
  description?: string;
  shortDescription?: string;
  searchKeywords?: string;       // ≤ PRODUCT_SEARCH_KEYWORDS_MAX_LENGTH
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

export const PRODUCT_SEARCH_KEYWORDS_MAX_LENGTH = 200;

/** The text-search config baked into the generated column. Must stay a literal. */
export const SEARCH_TEXT_CONFIG = 'english';
export const SEARCH_QUERY_MAX_LENGTH = 100;
export const SEARCH_MAX_TOKENS = 8;
/** Below this the frontend should not fire; the backend also treats it as no search. */
export const SEARCH_MIN_QUERY_LENGTH = 2;
/** ts_rank_cd normalisation: divide by rank + 1, so scores land in 0..1. */
export const SEARCH_RANK_NORMALIZATION = 32;
/** Pinned rather than inherited from pg_trgm.word_similarity_threshold (0.6). */
export const SEARCH_WORD_SIMILARITY_THRESHOLD = 0.6;
export const SEARCH_SUGGEST_LIMIT = 5;

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
   `variant_attribute_values` join tables; indexes. Include `searchKeywords` and
   the generated `searchVector` now — retrofitting a generated column later
   means dropping and recreating it.
2. `CatalogSearchInitializer` — extensions and GIN indexes. Do it here, before
   any search code, and confirm in Adminer that both indexes exist.
3. The pure helpers, driven by unit tests: `buildOptionsKey`,
   `assertVariantMatrix`, `parseAttributeFilter`, `buildSearchQuery`.
4. `ProductService.create` with the matrix validation and
   `recalculateAggregates`. Do this before any controller exists.
5. DTOs and `ProductsController` — CRUD, then the variant routes, then
   `generate`. Dashboard `search` lands here.
6. Image routes: upload, reorder, alt text, delete.
7. `PublicProductsController` — listing with built-in filters, then the
   `attributes` grammar, then detail by slug.
8. Storefront search: the ranked full-text query and `relevance` sort, then the
   trigram fallback and `didYouMean`, then `suggest`. Split deliberately —
   ranking is the feature, and the fallback is meaningless until ranking works.
9. `GET /site/:slug/filters` with counts.
10. `featuredProducts` + `hero.ctaHref`; `productCount` on both category DTOs;
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
- `buildSearchQuery` — this one guards a 500, so test it hard:
  - `red popco` → `red & popco:*`; only the **last** token gets `:*`.
  - Every `tsquery` operator is stripped, not escaped: `a & b`, `a | b`, `!a`,
    `(a)`, `a:*b`, `'a'`, `a <-> b` all produce a valid query.
  - `t-shirt (red)` → a query `to_tsquery` accepts.
  - Empty, whitespace-only, and punctuation-only input → `null`, never a throw.
  - Over-length input truncates to `SEARCH_QUERY_MAX_LENGTH`; more than
    `SEARCH_MAX_TOKENS` words truncate.
  - Arabic input survives intact.
  - **Property test worth the ten lines:** for random strings, the output is
    always either `null` or accepted by `to_tsquery` without error.
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
- Search, against a store seeded with "Popcorn Machine", "Popcorn Kernels" and
  a mug whose *description* mentions popcorn:
  - `?search=popcorn` → the two titled products rank above the mug.
    **Ranking is the feature; assert the order, not just the membership.**
  - `?search=running` matches "Running Shoe" and also a product titled
    "Run Faster" — stemming, both directions.
  - `?search=popco` (prefix) matches; `?search=opcorn` (not a prefix) does not.
  - `?search=popcorm` → `searchMode: "fuzzy"`, `didYouMean` set, the machine
    returned. This is the headline behaviour — assert it explicitly.
  - `?search=popcorn` → `searchMode: "exact"`, `didYouMean: null`, and **no
    second query is issued**.
  - `?search=zzzzzzz` → empty page, `searchMode: "fuzzy"`, `didYouMean: null`.
    Nothing matching is not an error.
  - `?search=` and `?search=a` → treated as no search at all, full page,
    `searchMode: null`.
  - `?search=a & b | !c (d):*` → 200, not a 500. Run the whole `tsquery`
    operator set through the live endpoint, not only the unit test.
  - A 500-character `search` → truncated, 200.
  - Search **combines** with facets: `?search=mug&attributes=colour:red` applies
    both, and `&category=kitchen&minPrice=…` narrows further.
  - A product found by `searchKeywords` alone (title says "Trainers", keywords
    say "sneakers") is returned for `?search=sneakers`, and ranks below one with
    it in the title.
  - Arabic: a store with Arabic titles returns exact and prefix matches, and a
    one-letter Arabic typo still resolves through the fuzzy pass.
  - A `draft` product never appears, whatever the search term.
  - Store A's product never appears in store B's search.
- `sort`: `?search=x` with no `sort` orders by relevance; `?sort=relevance` with
  no `search` returns the newest-first page and **200, not 400**; an explicit
  `?search=x&sort=price_asc` beats the relevance default.
- `suggest`: returns at most `SEARCH_SUGGEST_LIMIT`; `/suggest` does not resolve
  as a product slug; a draft product never appears; a term matching nothing
  returns `[]`.
- Dashboard `search`: finds a product by title *and* by an exact variant SKU;
  a SKU prefix matches; `archived` products are found; another store's SKU is not.
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
- **Elasticsearch, or any external search service.** It would be a fourth piece
  of infrastructure to run, secure and back up; an indexing pipeline that must
  re-sync on every product write; a second place tenant filtering has to be
  implemented correctly; and a class of bug — index drifting from the database —
  that a generated column simply does not have. It earns its place at millions
  of documents or serious relevance tuning, neither of which is a per-store
  catalog. Postgres gives ranking, stemming, prefix and fuzzy matching for two
  `CREATE EXTENSION` lines, and the storefront cannot tell the difference.
- **`ILIKE '%term%'`**, which this spec originally specified. It cannot rank, it
  cannot stem, one typo returns nothing, and the leading `%` forbids any index.
  Search is a headline feature of the storefront; substring matching is not it.
- **`similarity()` / `%` for the fuzzy pass.** Measured, not assumed: against a
  realistic long title it scores `0.109` and misses the typo that
  `word_similarity()` catches at `0.750`, because it divides by the length of
  the whole title. See [Search](#search).
- **`websearch_to_tsquery` instead of building the query.** It never throws on
  bad syntax, which is genuinely attractive, and it understands quoted phrases
  and `OR`. But it cannot produce a **prefix** match, and prefix is what makes
  as-you-type work. Sanitising into `to_tsquery` gets both, at the cost of one
  well-tested pure function.
- **A per-store text-search config driven by `Store.locale`.** A generated column
  demands an `IMMUTABLE` expression, so the config must be a literal. Doing it
  per store means a trigger, giving up the "Postgres maintains it for free"
  property that makes this design safe. Deferred until a store asks.
- **`unaccent` in the vector.** It is not `IMMUTABLE` as shipped, so a generated
  column rejects it; making it immutable means a custom wrapper function and a
  reindex. Trigram matching already absorbs most accent misses.
- **A materialised search table, or denormalising category and attribute names
  into the vector.** Both would let a shopper find a mug by searching "Kitchen".
  Both also mean the vector stops being a pure function of the product row, so
  every category rename has to fan out. The category filter already covers this.

## Deferred

- **Per-variant images** — the picker changing the gallery. The first thing a
  clothing store asks for; needs `ProductImage.variantId` nullable and a
  fallback rule.
- Bulk import/export (CSV), which every real owner will eventually ask for.
- Inventory event log feeding the forecasting module.
- Range and numeric facets (`weight between 1–5 kg`).
- A single grouped query for facet counts, if the per-attribute counts profile
  badly.
- **Zero-result search logging.** Every search that returns nothing is a
  customer telling the owner what they do not stock — the same signal
  [project-overview.md](../project-overview.md) mines from unanswered chatbot
  questions for the Daily AI Advisor (*"45 customers asked for wireless earbuds
  — you don't sell them"*). It wants its own small entity and belongs with the
  Advisor, not here, but the hook is one insert on the `searchMode: "fuzzy"`
  empty-result path.
- **Per-store text-search config** via a trigger instead of a generated column,
  once a store's Arabic catalog outgrows trigram-only morphology.
- **Semantic search** — "something for a 5-year-old girl's birthday", which
  matches no keyword. That is embeddings, not full-text, and it arrives with the
  chatbot's RAG. Worth knowing that `pgvector` would put it in the same database
  as everything above, letting one query filter by store, status and price while
  ranking by embedding distance; it needs the compose image swapped from
  `postgres:15-alpine` to `pgvector/pgvector:pg15`, since `vector` is the one
  extension the current image does not carry.
- **Synonym dictionaries** at the platform level. `searchKeywords` is the
  per-store answer; a shared `thesaurus` config would need per-store variants
  and a `tsvector` rebuild on every edit.
