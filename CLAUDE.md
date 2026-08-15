# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Context Files:

Read the following files to get the full context of the project

- @context/project-overview.md
- @context/coding-standards.md
- @context/ai-interactions.md
- @context/current-feature.md

## Commands

```bash
npm run start:dev          # watch-mode dev server
npm run build              # nest build -> dist/
npm run lint               # eslint --fix over src, test, scripts
npm run format             # prettier --write

npm run seed -- --force    # wipe and refill the dev database, print tokens and row ids

npm test                   # jest, rootDir=src, matches *.spec.ts
npm test -- users.service  # single suite by path/name substring
npm test -- -t "verifies"  # single test by name
npm run test:e2e           # jest --config ./test/jest-e2e.json (rootDir=test)

docker compose up -d       # postgres:5432, redis:6379, adminer:8080
```

Postgres/Redis come from [docker-compose.yml](docker-compose.yml). Note the compose file reads `POSTGRES_USER/PASSWORD/DB` from `.env` while the app reads `DATABASE_USER/PASSWORD/NAME` — both sets live in the same `.env` and must agree. Copy [.env.example](.env.example) to `.env` before anything runs.

## Architecture

NestJS 11 + TypeORM/Postgres + ioredis + nodemailer + Cloudinary + Gemini.

Five feature modules, each following the same shape — `entities/`, `dto/`, `enums/`, `utils/`, a `*.constants.ts`, one service per entity, one controller per route prefix, and a separate controller for the storefront half:

| Module | Owns | Surface |
| --- | --- | --- |
| `src/users` | `User` | Registration, login, OTP verification and reset |
| `src/site-builder` | `Store`, `StoreTheme`, `SiteBuildDraft` | The questionnaire → Gemini onboarding flow, and the public `GET /site/:slug` |
| `src/catalog` | `Category`, `ProductAttribute(+Value)`, `Product`, `ProductVariant`, `ProductImage` | The dashboard catalog, the storefront listing, facets and Postgres full-text search, and the AI catalog setup |
| `src/faq` | `Faq` | `/faqs` and `/site/:slug/faqs` |
| `src/orders` | `Order`, `OrderItem` | Checkout, the customer's history, the owner's order desk |

Support modules: `src/auth` (tokens + guard), `src/ai` (`GeminiService`), `src/storage` (`CloudinaryService`), `src/mail`, `src/redis`, `src/database`, `src/common`.

`src/payments` is the one module still to be written ([context/features/payments.md](context/features/payments.md)); [TODO.md](TODO.md) tracks the remaining gaps, of which OTP verification having no attempt limit is the one that matters.

### Config is validated and fully typed

[src/config/env.validation.ts](src/config/env.validation.ts) declares every env var on the `EnvironmentVariables` class with class-validator decorators; `validate` runs at boot via `ConfigModule.forRoot({ isGlobal: true, validate })` and **throws on any missing or mistyped var**. Adding a new env var means adding a field here plus `.env.example`, otherwise the app won't start.

Everywhere config is read it uses the generic + infer form, which gives compile-time key checking and correct return types (numbers come back as numbers thanks to `enableImplicitConversion`):

```ts
private readonly configService: ConfigService<EnvironmentVariables, true>
this.configService.get('JWT_ACCESS_SECRET', { infer: true })
```

Keep that pattern — dropping `{ infer: true }` silently degrades the type to `string`.

### Module wiring

- `RedisModule` and `MailModule` are `@Global()` — inject `RedisService`/`MailService` without importing anything.
- `DatabaseModule` sets `synchronize: true` **only** when `NODE_ENV === 'development'`. There is no migration setup yet; schema changes in dev apply by restarting.
- `AuthModule` exports `TokenService` + `JwtAuthGuard`; feature modules import `AuthModule` to protect routes.
- `JwtModule.register({})` is intentionally empty — secrets and expiry are passed per-`sign`/`verify` call in `TokenService` because access and refresh tokens use different secrets.
- `CatalogModule` imports `SiteBuilderModule` with `forwardRef` because the dependency genuinely runs both ways: the catalog resolves its store through `StoreService`, and the landing page's featured strips come from the catalog. `FaqModule` and `OrdersModule` need no `forwardRef` — nothing in the site builder reads an FAQ or an order.
- `CatalogModule` exports `ProductService` so `OrdersModule` can call `recalculateAggregates` (see below). Checkout otherwise reaches the catalog only through `ProductVariant` in its own transaction — it never writes a catalog row except that stock decrement.
- `CatalogSearchInitializer` is an `OnModuleInit` running `CREATE EXTENSION`/`CREATE INDEX … IF NOT EXISTS` for the search stack, because `synchronize` cannot express either. It is a **migration-era stopgap**: when migrations land its statements become the first migration and the class is deleted. Anything added there must be idempotent and must fail soft.

### Auth flow

[src/auth/token.service.ts](src/auth/token.service.ts) owns all token logic:

- Access token: signed with `JWT_ACCESS_SECRET`, stateless.
- Refresh token: carries a random `jti`; its SHA-256 hash is stored at Redis key `refresh:<userId>:<jti>` with a TTL derived from the token's own `exp`. `rotateRefreshToken` verifies, compares the hash, **deletes the key**, and issues a fresh pair — refresh tokens are single-use, and replay fails.
- `JwtAuthGuard` is a hand-rolled `CanActivate` (no passport). It parses `Authorization: Bearer <token>` and assigns `request.user`. Apply per-route with `@UseGuards(JwtAuthGuard)`; read the payload with `@CurrentUser()` ([src/common/decorators/current-user.decorator.ts](src/common/decorators/current-user.decorator.ts)). The `Request.user` augmentation lives in [src/common/types/express.d.ts](src/common/types/express.d.ts).

### OTP flow

Email verification and password reset share one mechanism in [src/users/users.service.ts](src/users/users.service.ts): a 6-digit `randomInt` code stored at `otp:<purpose>:<email>` with `OTP_EXPIRES_IN_SECONDS` TTL, mailed by `MailService.sendOtpEmail`. `purpose` is the `OtpPurpose` union (`'verify-email' | 'reset-password'`) defined in [src/mail/mail.service.ts](src/mail/mail.service.ts) — extending it means updating `buildContent` too.

Deliberate behaviours to preserve when editing this service:

- `createUser` deletes the just-created row and throws 503 if the OTP mail fails, so a user can never exist without a way to verify.
- `forgotPassword` returns the same generic message whether or not the account exists (anti-enumeration); `verifyEmail`/`resetPassword` return the same "invalid or expired" message for a bad code and an unknown email.
- `login` distinguishes 401 (bad credentials) from 403 (unverified email).

### Multi-tenancy — the invariant every commerce query obeys

> Every query touching a store-scoped table filters by `storeId`, and `storeId` always comes from the authenticated caller or the URL slug — **never from the request body**.

- Dashboard services start with `StoreService.resolveCallerStore(user)`: an `OWNER` carries `storeId: null` and is resolved through `Store.ownerId`, an `ADMIN` carries it in the JWT. That asymmetry is why the helper exists instead of each service re-deriving it.
- Storefront routes derive the store from `:slug` via `StoreService.resolvePublicStore(slug)`, which **404s a draft store** — that is what keeps an unpublished slug from leaking.
- No DTO declares a `storeId`; `forbidNonWhitelisted` then rejects any attempt to send one.
- A row of another store must **404, never 403** — a 403 confirms the id exists. `RolesGuard` (`@Roles(...)`) protects dashboard routes; `StoreScopeGuard` rejects a token issued for another store on a `:slug` route.

### Money, stock and orders

- **Every amount is an `int` of minor units** — `24900` is 249.00. Never `decimal` (TypeORM returns those as strings) and never a float. `Store.currency` says what they are denominated in, and the API never returns a formatted string.
- **Price, SKU and stock live on `ProductVariant`, never on `Product`**, and every product has at least one variant (a simple product has exactly one, flagged `isDefault`). That is what keeps checkout, stock and order snapshots from forking into a simple-versus-variable pair of code paths.
- **`ProductService.recalculateAggregates(productId, manager)` is the only writer** of `minPriceAmount`, `maxPriceAmount`, `totalStock` and `variantCount`. Every path that touches a variant — including the order module's reserve and restore — calls it inside the same transaction. Scattered arithmetic is how denormalised aggregates start lying.
- **Stock moves only through a conditional update**: `SET "stockQuantity" = "stockQuantity" - :qty WHERE id = :id AND "stockQuantity" >= :qty`. Zero rows affected means it is not there, and the throw rolls the transaction back. That is why the column can never go negative and why no lock is needed.
- **`OrderItem` is a snapshot**, not a join. `productTitle`, `productSlug`, `productImageUrl`, `sku`, `unitAmount` and `variantOptions` (attribute **labels**, not ids) are stored at purchase time; `productId`/`variantId` are links back for reporting only. Render an order from the snapshot — repricing, renaming or deleting a product must never rewrite history.
- **`OrderService.changeStatus` is the only writer of `Order.status`.** It checks `ORDER_STATUS_TRANSITIONS`, restores stock when cancelling from `pending`/`confirmed`, flips a delivered COD order to `paid`, and writes conditionally on the status it read so a concurrent change is a 409 rather than a second restore. The customer's cancel goes through it too.
- Orders are never deleted, only cancelled. `Category`, `ProductAttribute(+Value)`, `Product` and `ProductVariant` are soft-deleted so an order's links survive; `Faq` is hard-deleted because nothing points at it.

### Entity and DTO conventions

- `User.password` is `@Column({ select: false })`. Plain `findOne` will not load it — use the query builder with `.addSelect('user.password')`, as `login` and `changePassword` do.
- `User.id` is a `@PrimaryColumn('uuid')` filled by a `@BeforeInsert` hook calling `randomUUID()`, not a DB-generated column. `repository.create()` + `save()` works; raw inserts must supply an id.
- The global `ValidationPipe` in [src/main.ts](src/main.ts) uses `whitelist: true, forbidNonWhitelisted: true, transform: true` — any field not decorated on the DTO causes a 400, so every accepted field needs a validator.
- Responses are hand-mapped through static `fromEntity` factories (e.g. `UserResponseDto.fromEntity`) rather than a serializer interceptor. New response shapes should follow the same pattern so the `select: false` password can never leak.
- Cross-field validation uses the custom `@Match('otherField')` decorator in [src/common/validators/match.decorator.ts](src/common/validators/match.decorator.ts).
- Roles are `UserRole` (`OWNER | ADMIN | USER`). `POST /users/register/owner` and `POST /users/register` differ only in the role assigned; a store's buyer is a store-scoped `User` with `role = USER`, not a separate `Customer` entity.
- `@ValidateNested()` alone does not reject a **missing** object — pair it with `@IsObject()`, or the service dereferences `undefined` into a 500 where the client deserves a 400.
- Shared list plumbing lives in `src/common/dto`: `PaginationQueryDto` (feature query DTOs extend it), `PaginatedResponseDto.of(...)`, and `ReorderDto` for the "whole list at once, in one transaction" pattern. Query params arrive as strings, so numbers need `@Type(() => Number)` and booleans the `@ToBoolean()` transformer.

## Testing

- `npm test` runs Jest over `src`. **Pure helpers are unit-tested; services and controllers are not** — the rules that would otherwise only be reachable through a database are extracted into `utils/` functions and tested there (`buildUniqueSlug`, `assertVariantMatrix`, `buildSearchQuery`, `sanitizeGeneratedCatalog`, `calculateTotals`, `assertTransition`, …). Follow that when adding a rule worth trusting.
- Endpoints are verified against a running server with an API client per [context/ai-interactions.md](context/ai-interactions.md), scripted per branch; `npm run build` must pass before anything is committed.
- `src/app.controller.spec.ts` fails — it does not provide `ConfigService` for `AppService`. Pre-existing and unrelated to any feature branch.

## Notes

- `README.md` is the untouched NestJS starter README — it describes nothing project-specific. [SETUP.md](SETUP.md) is the real one, written for the frontend team.
- `npm run seed -- --force` wipes the database and refills it with three stores, seven accounts, the full catalog, FAQ entries and orders, then prints access tokens and row ids. It refuses to run outside `NODE_ENV=development`.
- CORS comes from the validated `CORS_ORIGINS` allowlist. No `@nestjs/swagger` and no global prefix — routes are exactly what the controllers declare.
