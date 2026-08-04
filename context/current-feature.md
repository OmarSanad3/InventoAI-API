# Current Feature

<!-- Nothing in flight. Fill this in when the next feature starts. -->

**E-commerce Core** — the commerce layer on top of the site builder, specified
as seven branches. Index: [features/ecommerce-core.md](./features/ecommerce-core.md).

## Status

In progress. Branches 1 and 2 of 7 are merged; branch 3 is next.

| # | Spec | Branch (planned) | Status |
| --- | --- | --- | --- |
| 1 | [categories.md](./features/categories.md) | `feature/categories` | Merged (`db14ae6`) |
| 2 | [product-attributes.md](./features/product-attributes.md) | `feature/product-attributes` | Merged (`550613a`, PR #5) |
| 3 | [products.md](./features/products.md) | `feature/products` | Specified, not started |
| 4 | [catalog-ai-setup.md](./features/catalog-ai-setup.md) | `feature/catalog-ai-setup` | Specified, not started |
| 5 | [faq.md](./features/faq.md) | `feature/faq` | Not started |
| 6 | [orders.md](./features/orders.md) | `feature/orders` | Not started |
| 7 | [payments.md](./features/payments.md) | `feature/payments` | Not started |

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

### Known gaps

- OTP *verification* has no attempt limit — `verifyEmail` and `resetPassword`
  accept unlimited guesses at a 6-digit code, which on `reset-password` is
  account takeover. Tracked in [TODO.md](../TODO.md), along with reaping
  abandoned unverified accounts. (The lockout gap itself is now closed.)
- No tests for the auth/user logic; the site-builder tests cover only the pure
  helpers (theme CSS, oklch, slug, monogram).
- `src/app.controller.spec.ts` fails — it does not provide `ConfigService` for
  `AppService`. Pre-existing, unrelated to this branch.
