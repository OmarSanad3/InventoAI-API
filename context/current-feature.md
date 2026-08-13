# Current Feature

<!-- Nothing in flight. Fill this in when the next feature starts. -->

**E-commerce Core** — the commerce layer on top of the site builder, specified
as seven branches. Index: [features/ecommerce-core.md](./features/ecommerce-core.md).

## Status

In progress. Branches 1–3 of 7 are merged. **Branch 4 is implemented and
verified**, awaiting review and merge.

| # | Spec | Branch (planned) | Status |
| --- | --- | --- | --- |
| 1 | [categories.md](./features/categories.md) | `feature/categories` | Merged (`db14ae6`) |
| 2 | [product-attributes.md](./features/product-attributes.md) | `feature/product-attributes` | Merged (`550613a`, PR #5) |
| 3 | [products.md](./features/products.md) | `feature/products` | Merged (`2018b4f`, PR #7) |
| 4 | [catalog-ai-setup.md](./features/catalog-ai-setup.md) | `feature/catalog-ai-setup` | **Implemented and verified** |
| 5 | [faq.md](./features/faq.md) | `feature/faq` | Not started |
| 6 | [orders.md](./features/orders.md) | `feature/orders` | Not started |
| 7 | [payments.md](./features/payments.md) | `feature/payments` | Not started |

### Branch 4 — what landed

`feature/catalog-ai-setup`, branched off `main` at `9eec650`. Spec:
[catalog-ai-setup.md](./features/catalog-ai-setup.md).

Two dashboard routes and no entity, no env var, no public surface:
`POST /catalog/generate` (one Gemini call from the questionnaire the owner
already answered, behind a Redis cooldown, **persisting nothing**) and
`POST /catalog/apply` (the edited proposal, re-validated from scratch, written
in one transaction, idempotent so a double-click cannot produce `abayas-2`).

Built in the order the spec asked for, correctness first:

- **`sanitizeGeneratedCatalog`** (`utils/sanitize-catalog.util.ts`) — the pure
  function the whole validation table lives in, plus `isCatalogProposalEmpty`,
  which is what decides between a retry and a 503.
- **`planCatalogWrite`** (`utils/plan-catalog-write.util.ts`) — the second pure
  function, and the one the spec did not ask for by name: it decides what an
  apply writes and what it skips. Extracted because the skip rule is the other
  half of the correctness story and is otherwise only reachable through a
  database.
- `generate-catalog.prompt.ts`, `CatalogAiService`, the four DTOs, then
  `CatalogSetupController`.

The write path goes through the owning services, as specified —
`CategoryService.createBatch` and `ProductAttributeService.createBatch`, both
taking the caller's `EntityManager` so the whole apply is one transaction. They
resolve no store of their own: `CatalogAiService` already did that, and a second
`resolveCallerStore` inside the transaction would be a second answer to a
question already settled.

The trap the spec named is handled and tested from both ends. `أحذية` and
`قمصان` become `category` and `category-2`, not one category and one silently
dropped name — so **skip-on-apply matches by name first**, and by slug only when
the slug is not the fallback (see the deviations below).

Shared plumbing this branch carries:

- `RedisService.ttl(key)` — the cooldown 429 names the seconds left, and `GET`
  alone cannot say how many.
- `AI_UNAVAILABLE_MESSAGE`, exported from `GeminiService`, so the 503 this
  branch raises after its own retries is worded exactly like an outage.
- `SiteBuilderService.describeBusinessForOwner(ownerId)`, and
  `SiteBuilderService` is now exported from `SiteBuilderModule`.

Deviations from [catalog-ai-setup.md](./features/catalog-ai-setup.md), all
deliberate:

- **The skip rule matches names, not only slugs.** The spec says "an entry whose
  slug or key already exists is skipped". Taken literally that is wrong for
  exactly the store the spec worries about: every Arabic name slugifies to
  `category`, so the *third* Arabic category an owner ever adds would be skipped
  as a duplicate of the first. The rule implemented is: skip when the name
  matches (case-insensitively), **or** when the slug matches and is not the
  fallback. A double-click still produces no `abayas-2`, which is what the rule
  was for.
- **`MIN_GENERATED_VALUES_PER_ATTRIBUTE` is a named constant**, not the literal
  `2` the validation table spells.
- **A too-long category description is cleared, not fatal.** The table does not
  cover the field at all; dropping the category over its description would be
  the harsher reading of "dropping beats rejecting".
- **A value that breaks its length bounds is dropped like a duplicate.** Also
  not in the table, and necessary: the apply DTO would 400 on it, so a proposal
  containing one could never be applied.
- **Value bounds are checked after de-duplication**, so an attribute is not lost
  because two of its values repeated.
- **`CATALOG_GENERATION_TEMPERATURE` (0.7)** is new — the `GeminiService`
  default of `0.9` is tuned for generating distinct *themes*, and a catalog
  wants the boring answer.
- **The cooldown is cleared when the generation fails.** It is still set before
  the Gemini call, as specified, but an owner who got nothing should not wait
  30s to try again — which is what the spec's own outage test asks for.
- **Both routes return 200, not 201.** A proposal is not a created resource, and
  an apply that skipped everything created nothing.
- **`ApplyCatalogDto` reuses `CreateCategoryDto` and `CreateAttributeDto`** for
  its entries rather than declaring its own. That *is* the spec's "same rules as
  the hand-driven create DTOs", and it means a rule can never drift between the
  two paths. The side effect is that an apply may also carry `slug`,
  `isPublished`, `isFeatured`, `isFilterable` and `showOnProductPage` — all
  honoured, none required.

### Re-spec, 2026-08-01

The epic was five branches and assumed no variants and free-form `jsonb`
attributes. Both were wrong for a store *builder* and were replaced before any
of the affected code was written:

- **Attributes are rows, not columns.** A builder cannot hardcode `size` and
  `color`, so each store declares its own attributes with a controlled value
  list. Free text was rejected: one owner typing `XL`, `xl` and `X-Large`
  produces three filter options that each match one product.
- **Every product has variants** — a simple product has exactly one, flagged
  `isDefault`. The alternatives were three separate products per T-shirt, or one
  product that cannot express "3 left in M". The unconditional variant removes
  the simple-vs-variable fork from checkout, stock and orders.
- **`isVariantAxis`** separates Size/Colour (change price and stock, shopper
  picks one) from Material/Brand (describe the product, filter only).
- **AI catalog setup** — one Gemini generation proposing categories *and*
  attributes *and* values *and* their display styles, from the questionnaire the
  owner already answered.

### Search re-spec, 2026-08-04

Storefront search was `ILIKE '%term%'`, with real full-text listed under
[products.md](./features/products.md)'s Deferred. Promoted to a headline feature
of branch 3 instead, still entirely inside Postgres:

- **Ranking and stemming** — a generated, stored `Product.searchVector` with
  `title`/`searchKeywords`/`shortDescription`/`description` weighted `A`–`D`,
  ordered by `ts_rank_cd`, `relevance` becoming the default sort when a search
  is present. A title match beats a description match by design.
- **Typo tolerance** — `pg_trgm`, but only as a second query after full-text
  returns nothing, which is also what fills `didYouMean`.
- **Prefix matching** — `:*` on the final token, plus a `suggest` endpoint for
  the autocomplete dropdown.
- **No Elasticsearch.** Two `CREATE EXTENSION` lines against the Postgres already
  running, no second datastore, no index that can drift from the rows.

Two things were measured against the running container rather than assumed, and
both changed the design: `word_similarity`/`<%` must be used instead of
`similarity`/`%` (on a realistic long title the latter scores `0.109` and misses
the typo the former catches at `0.750`), and Arabic tokenises correctly under the
`'english'` config — no stemming, but exact and prefix search work, and trigram
covers the rest. `pg_trgm`, `btree_gin`, `unaccent` and `fuzzystrmatch` are all
present in `postgres:15-alpine`, so no image change.

Cost of doing it now rather than later: one generated column on a table that does
not exist yet. Doing it after products ship means dropping and recreating that
column, plus a rewrite of the public listing query.

Doing this now is the cheap moment: `Product` and `Order` do not exist yet, so
nothing has to be migrated. After orders ship, the same change would mean
rewriting checkout against live order history.

### Branch 1 — what landed

Shared plumbing (it is the first branch, so it carries it):

- `StoreService.resolveCallerStore(user)` — `OWNER` via `Store.ownerId`,
  `ADMIN`/`USER` via the JWT's `storeId`.
- `src/common/dto/pagination-query.dto.ts` (+ an `offset` getter) and
  `src/common/dto/paginated-response.dto.ts`.
- `src/common/transformers/to-boolean.transformer.ts` — `@ToBoolean()`, because
  `Boolean("false")` is `true` and query params arrive as strings.
- `Store.currency` (`varchar(3)`, default `EGP`, constant `DEFAULT_CURRENCY`)
  and `Store.nextOrderNumber` (`int`, default `1`).

Categories themselves: `src/catalog` with the `Category` entity (both indexes,
partial unique on `deletedAt IS NULL`), `CategoryService`, the eight dashboard
routes, `GET /site/:slug/categories`, and `buildUniqueSlug` + its unit tests.

Deviations from [categories.md](./features/categories.md), both deliberate:

- **`productCount` is not in `CategoryResponseDto` / `CategoryPublicDto`.** The
  `product_categories` join table arrives with
  [products.md](./features/products.md), so the number would be a hardcoded `0`
  today. Left out for the same reason `TODO.md` left the featured lists out —
  the response never advertises a field the backend cannot fill. Both DTOs carry
  a `TODO(products)` marker at the spot.
- **The featured strip is assembled in `SiteController`, not inside
  `resolvePublicStore`.** Same two indexed selects, but putting it in
  `StoreService` would make `StoreService` ↔ `CategoryService` a provider-level
  cycle. Controller-level composition keeps `forwardRef` at the module level
  only.

`hero.ctaHref` still defaults to `null`; pointing it at the products page waits
for that page to exist.

### Branch 2 — what landed

`src/catalog` gains the attribute half: `AttributeDisplayStyle`, the
`ProductAttribute` and `ProductAttributeValue` entities with all four indexes,
`ProductAttributeService`, and the ten `/product-attributes` dashboard routes.
No public surface — the storefront sidebar also needs per-value product counts,
which ship with [products.md](./features/products.md).

Shared plumbing this branch carries:

- `src/common/dto/reorder.dto.ts` — `ReorderDto` + `PositionItemDto`, the shape
  categories established, now generic for the specs still to come.
  `ReorderCategoriesDto` was left alone rather than migrated, so the two are
  field-for-field duplicates for now —
  [fixes/duplicate-reorder-dto.md](./fixes/duplicate-reorder-dto.md).
- `slugifyToken` (`src/catalog/utils/slugify-token.util.ts`) — see the bug
  below.

The seed carries the branch too: `SEED_STORES` gains an `attributes` list per
store — `layali` gets five (chip/swatch/dropdown/list, one deliberately
unfilterable), `fokhar` four with a different vocabulary, `draftco` none so the
"built-ins only" case is reachable. `npm run seed -- --force` now prints a
**Catalog** block of store, category and attribute ids, so a `/:id` route can be
called from Apidog or curl without listing first. [SETUP.md](../SETUP.md) leads
with the commerce layer and tells the frontend team to build it before the auth
and onboarding screens, which the seeded tokens make unnecessary for now.

Deviations from [product-attributes.md](./features/product-attributes.md):

- **`productCount` is not in `AttributeResponseDto`**, for the same reason
  branch 1 left it off `CategoryResponseDto`: nothing can reference a value
  until `Product` exists, so the number would be a hardcoded `0`. There is a
  `TODO(products)` marker at the spot. The delete guard **is** wired — it calls
  `countProductsUsingAttribute` / `countProductsUsingValue`, which return `0`
  with the same marker, so closing the gap in the products branch is one query
  each and no new call sites.
- **Leaving `swatch` clears the values' colours** instead of rejecting the
  write. The spec's two rules — swatch needs a hex everywhere, non-swatch must
  have none — deadlock read literally: a `swatch` attribute cannot drop a hex,
  and a non-`swatch` one cannot keep one, so the style could never change.
  Clearing keeps the schema honest and the write possible.
  **Consequence, worth knowing:** the move is one-way. Once an attribute leaves
  `swatch` its colours are gone, so switching back 400s listing every value that
  now needs one, and a colour cannot be set while the style is not `swatch`. The
  escape is the same one `isVariantAxis` already uses — delete the attribute and
  create it again. If that proves annoying in the dashboard, the fix is to let
  `PATCH /product-attributes/:id` carry the values' colours in the same request.

### Branch 3 — what landed

The catalog itself. `src/catalog` gains `Product`, `ProductVariant` and
`ProductImage`, the three join tables, the fourteen `/products` dashboard
routes, the four storefront routes, and the Postgres search stack the
[search re-spec](#search-re-spec-2026-08-04) called for.

Structure, because one service would have broken the class-size rule badly:
`ProductService` (CRUD + the aggregates), `ProductVariantService`,
`ProductImageService`, `PublicProductService` and `ProductFilterService`.
`ProductService.recalculateAggregates` is **public** rather than private, so the
variant service and later the order module can call the single writer instead of
each growing their own arithmetic — the spec's rule survives, its `private`
does not.

Search, in the order it was built: the generated `searchVector`,
`CatalogSearchInitializer`, then ranking, then the trigram fallback, then
`suggest`. Confirmed against the running container — the column is
`GENERATED ALWAYS … STORED`, `IDX_products_search` is a GIN over
`("storeId", "searchVector")`, `IDX_products_title_trgm` a GIN over
`title gin_trgm_ops`, and `pg_trgm`/`btree_gin` are installed.

Five pure helpers carry the rules, each with unit tests: `buildOptionsKey`,
`assertVariantMatrix`, `parseAttributeFilter`, `buildSearchQuery`,
`assertComparePrice`, plus `buildPublicProductPredicates` so the listing's
where-clauses are assertable without a database. 110 unit tests pass (the one
failure is the pre-existing `app.controller.spec.ts`).

Deviations from [products.md](./features/products.md), all deliberate:

- **The product↔value join table is `product_descriptive_values`, not
  `product_attribute_values`.** The spec's name is already taken — it is the
  table of the `ProductAttributeValue` entity itself, so the two would have
  collided at `synchronize`. Everything else about the relation is unchanged.
- **`buildSearchQuery` replaces stripped punctuation with a space rather than
  removing it**, so `t-shirt` becomes `t & shirt`, which matches the
  `'t-shirt' 't' 'shirt'` Postgres indexes for "T-Shirt". The spec's illustrated
  `tshirt` matches nothing.
- **`SEARCH_INPUT_MAX_LENGTH` (2000) is a new constant.** The DTO first capped
  `search` at `SEARCH_QUERY_MAX_LENGTH`, which made the spec's own test — "a
  500-character search truncates, 200" — a 400. The DTO's bound is now the
  "someone is probing us" limit; `buildSearchQuery` still truncates to 100.
- **`ReorderDto` is reused for products and images**; no
  `reorder-products.dto.ts` or `reorder-images.dto.ts` was created. The shared
  DTO already says exactly this, and
  [fixes/duplicate-reorder-dto.md](./fixes/duplicate-reorder-dto.md) exists
  because branch 2 did *not* do this.
- **`CategoryPublicDto.productCount` is `number | null`**, not a bare number.
  The category chips on a product card are not counted, and a `0` there would
  read as "this category is empty" — which is the same reason branches 1 and 2
  left the field out entirely rather than hardcoding it.
- **`StoreHeroDto.fromEntity` takes `{ withDefaults }`.** The storefront gets
  `hero.ctaHref = /{slug}/products`; the dashboard editor still gets the stored
  `null`, or the owner would be shown a value they never chose and could save it
  by accident on the next PATCH.
- **`productCount` is still absent from `AttributeResponseDto`.** Branch 3 was
  scoped to close `countProductsUsing` — the delete guard — and that is done and
  verified. A per-value count for the dashboard is a separate grouped query and
  the storefront already gets it from `/site/:slug/filters`.

Two behaviours worth knowing before building against them:

- **Facets are matched per *product*, not per variant.** `size:xl;color:black`
  is one `EXISTS` per facet, AND-ed, exactly as the spec's SQL specifies — so a
  mug sold in XL/ivory and S/black matches. That is what every commerce site
  does ("which products come in XL and in black"), but it is not variant-level
  intersection and the frontend should not promise that it is.
- **`lowStock` with an unset threshold means "out of stock".**
  `lowStockThreshold` defaults to `0` and the filter is `stockQuantity <=
  lowStockThreshold`, so a product with any sold-out variant appears. Literal
  reading of the spec, and useful — but it makes the filter broad until owners
  set thresholds.

The seed carries the branch too: `SEED_STORES` gains a `products` list per
store — 14 products and 31 variants covering two axes, one axis, a simple
product, a `compareAtAmount`, a keywords-only match, an Arabic title, a draft
and an archived row. Products are written straight through the repository like
the rest of the seed, with one exception: the four derived columns go through
`ProductService.recalculateAggregates`, because a seed computing its own would
be the first place they could start lying. `npm run seed -- --force` now prints
a **products** block per store and a Try-it section with the search calls.
[SETUP.md](../SETUP.md) documents the facet grammar, the search modes and the
debounce rules the frontend has to honour.

### Bug found while implementing branch 2

`slugify()` is the **store-name** slugifier: it enforces `SLUG_MIN_LENGTH` (3)
and returns `SLUG_FALLBACK` (`my-store`) below it. Deriving an attribute value's
slug with it turned the size `S` into `my-store`, `M` into `my-store-2` and `L`
into `my-store-3`. Branch 2 derives catalog tokens with `slugifyToken` instead —
same normalisation, no minimum, a caller-supplied fallback for text with no
Latin characters at all (`أحمر` → `value`).

**`CategoryService.create` still calls `slugify`**, so a category named `AB`
(two characters, which the DTO allows) gets the slug `my-store`. Not touched
here — it is merged code outside this branch — but it is a one-line fix to
`slugifyToken({ text: name, fallback: 'category', maxLength: … })` whenever we
decide to take it.

## Goals

Give a built store something to sell: owner-managed categories, store-defined
attributes and filters, products with variants, images and stock, an FAQ,
customer checkout with COD and card payment, and an order dashboard. Also closes
the catalog half of [TODO.md](../TODO.md) — the landing page finally gets its
featured products and categories.

## Notes

Decisions taken while specifying, all recorded in
[ecommerce-core.md](./features/ecommerce-core.md):

- The buyer is a store-scoped `User` (`role = USER`), not a new `Customer`
  entity. No guest checkout in v1; `Order.userId` is nullable so adding it later
  is not a schema change.
- The cart lives in the client. No `Cart` entity; checkout posts line items
  (addressing **variants**) and the server re-prices every one.
- Every product has at least one variant; price, sku and stock live there.
- Money is stored as **integer minor units** with `Store.currency`, never
  `decimal` (TypeORM returns those as strings) and never floats.
- Custom facets travel as one whitelisted query param —
  `?attributes=size:xl,l;color:red` — because `forbidNonWhitelisted` would 400
  a `?size=xl` that no DTO can declare. OR within a facet, AND across facets.
- Display style is stored per attribute (`swatch` = coloured circles, `chip` =
  neutral circles with the text inside, `list`, `dropdown`), so the frontend
  never guesses from the attribute's name.
- Card payment goes through a `PaymentProvider` port. **Paymob is the assumed
  adapter** (Egypt/MENA); confirm before writing it — it decides the env vars
  and the webhook signature scheme.
- New modules: `src/catalog`, `src/orders`, `src/payments`, `src/faq`.
- New env vars: payments only — `PAYMENT_PROVIDER`, `PAYMOB_*`,
  `PAYMENT_RETURN_URL`, `ORDER_PAYMENT_TIMEOUT_MINUTES`. The AI catalog setup
  reuses the existing `GEMINI_*` vars.
- Existing code changed: `Store` gains `currency` and `nextOrderNumber`;
  `StorePublicResponseDto` gains `featuredProducts` / `featuredCategories`;
  `main.ts` needs `rawBody: true` for webhook HMAC verification.

## To verify

<!-- The commands / endpoints that prove the feature works. -->

```bash
docker compose up -d
npm run seed -- --force
npm run start:dev
```

Branch 1 was verified end to end against a running server: create (including the
`summer-sale` → `summer-sale-2` de-duplication and the same slug succeeding in
two stores), the dashboard list with `search`/`isPublished`/`isFeatured` filters
and pagination, get/update/delete, reorder, both image routes, and
`GET /site/:slug/categories`. Every cross-tenant attempt 404s, a `USER` token
403s, `storeId` in the body 400s, a rejected reorder writes nothing, a draft
slug 404s on the storefront, replacing an image destroys the old Cloudinary
asset, and a soft delete leaves it alone.

The ad-hoc rows used for that pass have been replaced by `npm run seed` — three
stores (`layali` and `fokhar` live, `draftco` draft) and seven accounts, all
`@inventoai.test` with the password `Password123!`. It prints ready-made access
tokens, so the frontend team can work the dashboard without a login screen.
[SETUP.md](../SETUP.md) is what they follow.

Branch 2 was verified the same way, against the seeded stores: "Size" created
with S/M/L/XL in one request (four values, positions 0–3, slugs `s`/`m`/`l`/`xl`
— the bug above), a second "Size" keyed `size-2`, and the same key succeeding in
the other store. A swatch attribute with an uncoloured value 400s naming it, a
`swatchHex` under `chip`/`list` 400s, `#f00` 400s at the DTO, a reserved key
400s whether it is sent or derived from the name (`Category` → `category`), and
`storeId` or `isVariantAxis` in a body 400s as `should not exist`. Values add,
rename, re-slug with de-duplication (`xl` → `xl-2`), delete, and the freed slug
is immediately reusable. Both reorder routes apply in one transaction and write
nothing when an id is foreign, duplicated or from another attribute. Every
cross-tenant verb 404s, an `ADMIN` of the store sees exactly what its `OWNER`
does, a `USER` token 403s, and both caps hold — the 21st attribute and the 101st
value 400. Deleting an attribute soft-deletes its values with it (checked in
Postgres) and frees the key.

The rows from that pass were removed by re-running `npm run seed -- --force`.

Branch 3 was verified the same way but scripted, in three passes against a
freshly seeded database — **151 endpoint checks, all passing**.

*Dashboard (59).* A simple product comes back with `variantCount 1`,
`minPriceAmount == maxPriceAmount` and `isDefault: true`; a two-axis product
with three distinct combinations and the right min/max/total. Every matrix rule
rejects from the live endpoint: an axis value at product level, a descriptive
value on a variant, mismatched axes between variants, the same combination sent
in two orders, a bare variant beside others, two sizes on one variant,
`compareAtAmount` at or below `priceAmount`, an empty variant list, negative
stock, `storeId` in the body, and a duplicate SKU (409, not 400). A foreign
`categoryId` 400s and writes **no** join rows. `generate` turns 3×2 into six
variants and re-running it adds nothing while leaving the pre-existing price
alone; widening to 5×6 fills to thirty; an axis that is not one, and a value
from the wrong attribute, both 400. Editing a variant's price moves
`minPriceAmount`, deleting one recomputes both, and deleting the last is a 400.
Dashboard `search` finds a product by title, by exact SKU and by SKU prefix, and
never another store's. `?size=xl` 400s, which is the mistake the frontend will
make first. Every cross-tenant verb 404s, a `USER` token 403s, no token 401s.

*Storefront (79).* `?search=popcorn` ranks the two titled products above the mug
that only mentions it in its description — the order is asserted, not the
membership. `running` matches "Running Shoe" and "Run Faster Socks" both ways
through the stemmer; `popco` matches as a prefix and `opcorn` does not reach
full-text at all. `popcorm` comes back `searchMode: "fuzzy"` with `didYouMean`
set and the machine in the results; `zzzzzzz` is an empty fuzzy page with
`didYouMean: null`, which is not an error. `?search=`, `?search=a`,
`a & b | !c (d):*` and a 500-character term are all 200. A product found only
through `searchKeywords` is returned and ranks below one with the word in its
title. A `draft` product 404s on its own slug and is absent from search until
flipped to `active`; an `archived` one is invisible to shoppers and present in
the dashboard; store A's catalog never appears in store B's search; a draft
store 404s. The facet grammar unions within a facet, intersects across facets,
and ignores an unknown key or value. `sort=relevance` with no search is a 200
newest-first page. `suggest` caps at five, excludes drafts, returns `[]` for
nothing, and does not resolve as a product slug. The detail page exposes
`stockLeft: 4` and `null` above the threshold and **no** `stockQuantity`
anywhere. `/filters` returns the price range, per-category and per-value counts,
keeps a zero count rather than dropping it, omits the unfilterable attribute,
passes `displayStyle` and `swatchHex` through, and — the rule that makes a
sidebar usable — leaves a facet's own selection out of its own counts while
narrowing every other. Arabic resolves exactly, by prefix, and through the fuzzy
pass on a one-letter typo. The landing page carries `featuredProducts` and
`hero.ctaHref: /layali/products`.

*Images (13).* Nine files 400 **before** any upload, leaving no orphaned
Cloudinary asset; eight store at positions 0–7; reorder, alt text and its
clearing work; deleting an image destroys the real Cloudinary asset (the URL
404s afterwards) and another store's image id 404s.

Also confirmed directly in Postgres: the generated column, both GIN indexes,
both extensions, all three partial unique indexes, and an index on **both**
columns of each join table.

Branch 4 was verified the same way and scripted, against a freshly seeded
database — **60 endpoint checks, all passing**, the last block against live
Gemini.

*Apply (49).* The same payload applied twice creates 2 categories and 3
attributes the first time and **nothing** the second, reporting all five as
skipped by slug/key, with no `ai-abayas-2` anywhere. Values keep the order they
were sent — `S, M, L, XL, 2XL` at positions 0–4, which no sort produces — the
swatch attribute keeps a hex on every value, the `list` one has none, and
`isVariantAxis` survives the write. Each of the three invalid payloads (a
reserved key, a `swatchHex` under `chip`, a `swatch` missing one hex) 400s
**and leaves the category count unchanged**, which is the transaction. Three
Arabic names produce `category`, `category-2` and — for `عبايات AI` — `ai`, and
re-applying them creates nothing. An `ADMIN` of the store acts on the same
store as its `OWNER`; store B's owner writing `AI Abayas` leaves store A's copy
alone and gets its own. A `USER` token 403s, no token 401s, `storeId` in the
body 400s, an empty apply is a 200 that writes nothing, and a 501-character
`instructions` 400s.

*Generate (11, live Gemini).* The abaya shop came back with Size as a `chip`
axis (`S/M/L/XL/2XL`), Colour as a `swatch` axis with a hex on all eight values,
and Fabric and Style as descriptive `list`s — asserted, not eyeballed: no
swatch value without a hex, no hex outside a swatch, no attribute under two
values, no reserved key. A second call 15s later 429s with
`please wait 15 seconds`. Steering the draft store with "we are a bookshop"
produced English Novels/Arabic Novels/Classics and Language, Author, Genre,
Format — **no size attribute**, which is the case a model that always returns
three attributes would get wrong. Generating changed no row in either store,
and feeding the proposal straight back into `apply` worked unedited, skipping
the categories and attributes the seed had already given that store — the
"the owner may already have a catalog" case, working.

Not covered by the script: the Gemini-outage 503 and the cooldown it clears,
which would need the key broken on a running server.

## History

<!-- Keep this updated> Earliest to latest -->

| Date | Feature | Status | Commit |
| --- | --- | --- | --- |
| 2026-07-15 | Project setup — NestJS 11 scaffold, ESLint/Prettier, Jest + e2e config | Completed | `7bc6196` |
| 2026-07-18 | Database — TypeORM/Postgres `DatabaseModule`, Docker Compose (Postgres, Redis, Adminer) | Completed | `e8b87c9` |
| 2026-07-18 | Config — typed & validated env via `EnvironmentVariables` + `validate`, global `ConfigModule` | Completed | `c894d63` |
| 2026-07-20 | Config fix — definite assignment assertions on env variables | Completed | `887f518` |
| 2026-07-23 | Auth & users — `User` entity, register (owner/user), login, JWT access + rotating single-use refresh tokens, `JwtAuthGuard`, `@CurrentUser()`, global `RedisModule`/`MailModule`, OTP email verification & password reset, change password, DTOs + `@Match` validator | Completed | `d523672` |
| 2026-07-29 | Site building — feature spec written ([features/site-building.md](./features/site-building.md)) | Completed | `c7f043b` |
| 2026-07-30 | Site building — `RolesGuard`, `Store`/`StoreTheme`/`SiteBuildDraft`, Gemini + Cloudinary services, the five flow endpoints and the public `GET /site/:slug` | Completed | `bae7739` |
| 2026-07-31 | CORS — `enableCors` in `main.ts` driven by a new validated `CORS_ORIGINS` allowlist, `Authorization` header allowed for the Angular client | Completed | `fcdaa6c` |
| 2026-07-31 | Users scoped to a store — nullable `User.storeId` (null for OWNER), two partial unique email indexes, store/`owner` split of every auth route, store-scoped OTP keys, `storeId` in the JWT, branded HTML OTP emails + `PLATFORM_LOGO_URL` ([fixes/user-scoped-to-store.md](./fixes/user-scoped-to-store.md)) | Completed | `249794f` |
| 2026-07-31 | Resend verification OTP — `POST /users/resend-verification[/owner]`, generic 200 in every case, Redis cooldown keyed before the user lookup + `OTP_RESEND_COOLDOWN_SECONDS`, `resetPassword` now flips `isEmailVerified` ([features/resend-verification-otp.md](./features/resend-verification-otp.md)) | Completed | `1ada2fa` |
| 2026-08-01 | E-commerce core branch 1 — `Category` entity + dashboard CRUD, reorder, image routes, `GET /site/:slug/categories`, `featuredCategories` on the landing page, plus the shared plumbing (`resolveCallerStore`, pagination DTOs, `@ToBoolean()`, `Store.currency`/`nextOrderNumber`) ([features/categories.md](./features/categories.md)) | Completed | `db14ae6` |
| 2026-08-01 | E-commerce core re-spec — variants, store-defined attributes, AI catalog setup; five branches become seven ([features/ecommerce-core.md](./features/ecommerce-core.md)) | Completed | `db14ae6` |
| 2026-08-02 | Dev seed script — `npm run seed -- --force` wipes and refills the database with three stores, seven accounts and their categories, prints access tokens; `RedisService.deleteByPattern`; [SETUP.md](../SETUP.md) for the frontend team | Completed | `chore/seed-script` |
| 2026-08-03 | E-commerce core branch 2 — `ProductAttribute` + `ProductAttributeValue`, display styles, `isVariantAxis`, the ten `/product-attributes` routes, `ReorderDto`, `slugifyToken`, seeded attributes per store ([features/product-attributes.md](./features/product-attributes.md)) | Completed | `550613a` |
| 2026-08-04 | Search re-spec — storefront search promoted from `ILIKE` to ranked Postgres full-text with stemming, prefix and `pg_trgm` typo tolerance, folded into branch 3 ([features/products.md](./features/products.md#search)) | Completed | `docs/product-search` |
| 2026-08-06 | E-commerce core branch 3 — `Product`/`ProductVariant`/`ProductImage`, the variant matrix and `generate`, the four derived aggregates with a single writer, images, the storefront listing with custom facets, ranked Postgres full-text with prefix, `pg_trgm` typo fallback and `suggest`, `GET /site/:slug/filters` with per-facet counts, `featuredProducts` + `hero.ctaHref`, `productCount` on both category DTOs, and the `countProductsUsing` guard closed ([features/products.md](./features/products.md)) | Completed | `2018b4f` (PR #7) |
| 2026-08-13 | E-commerce core branch 4 — AI catalog setup: `POST /catalog/generate` (one Gemini call from the stored questionnaire, Redis cooldown, persists nothing) and `POST /catalog/apply` (one transaction through `CategoryService.createBatch` / `ProductAttributeService.createBatch`, idempotent by name and slug), `sanitizeGeneratedCatalog` + `planCatalogWrite` with 39 unit tests, `RedisService.ttl`, `SiteBuilderService.describeBusinessForOwner` ([features/catalog-ai-setup.md](./features/catalog-ai-setup.md)) | Implemented, verified, unmerged | `feature/catalog-ai-setup` |

### Known gaps

- **`Category.productCount` costs one extra grouped query per list response.**
  Cheap and indexed, but it is a second round trip on every category read; if it
  ever profiles badly the fix is `loadRelationCountAndMap` on a query builder.
- **`CategoryService.create` still calls `slugify`**, so a two-character name
  gets the slug `my-store`. Unchanged from the branch-2 note above — it is
  merged code outside this branch, and still a one-line fix to `slugifyToken`.
- **The facet counts are one query per filterable attribute.** With ≤20
  attributes and typically three or four filterable that is a handful of
  indexed counts; the single-grouped-query upgrade is noted in the spec, not
  built.
- OTP *verification* has no attempt limit — `verifyEmail` and `resetPassword`
  accept unlimited guesses at a 6-digit code, which on `reset-password` is
  account takeover. Tracked in [TODO.md](../TODO.md), along with reaping
  abandoned unverified accounts. (The lockout gap itself is now closed.)
- No tests for the auth/user logic; the site-builder tests cover only the pure
  helpers (theme CSS, oklch, slug, monogram).
- `src/app.controller.spec.ts` fails — it does not provide `ConfigService` for
  `AppService`. Pre-existing, unrelated to this branch.
