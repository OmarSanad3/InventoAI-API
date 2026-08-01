# Current Feature

<!-- Nothing in flight. Fill this in when the next feature starts. -->

**E-commerce Core** — the commerce layer on top of the site builder, specified
as seven branches. Index: [features/ecommerce-core.md](./features/ecommerce-core.md).

## Status

In progress. Branch 1 of 7 is implemented and verified; not merged yet.

| # | Spec | Branch (planned) | Status |
| --- | --- | --- | --- |
| 1 | [categories.md](./features/categories.md) | `feature/categories` | Implemented, verified, awaiting merge |
| 2 | [product-attributes.md](./features/product-attributes.md) | `feature/product-attributes` | Specified, not started |
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

Seed rows are still in the dev database — three owners (`owner.alpha@`,
`owner.beta@`, `owner.draft@`), an `admin.alpha@` and a `shopper@`, all
`@test.local` with the password `Passw0rd!23`, plus the stores `alphastore`
(live), `betastore` (live) and `draftstore` (draft).

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

### Known gaps

- OTP *verification* has no attempt limit — `verifyEmail` and `resetPassword`
  accept unlimited guesses at a 6-digit code, which on `reset-password` is
  account takeover. Tracked in [TODO.md](../TODO.md), along with reaping
  abandoned unverified accounts. (The lockout gap itself is now closed.)
- No tests for the auth/user logic; the site-builder tests cover only the pure
  helpers (theme CSS, oklch, slug, monogram).
- `src/app.controller.spec.ts` fails — it does not provide `ConfigService` for
  `AppService`. Pre-existing, unrelated to this branch.
