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
| `src/users` | `User` | Registration, login, Google Sign-In, OTP verification and reset |
| `src/site-builder` | `Store`, `StoreTheme`, `SiteBuildDraft` | The questionnaire → Gemini onboarding flow, and the public `GET /site/:slug` |
| `src/catalog` | `Category`, `ProductAttribute(+Value)`, `Product`, `ProductVariant`, `ProductImage` | The dashboard catalog, the storefront listing, facets and Postgres full-text search, and the AI catalog setup |
| `src/faq` | `Faq` | `/faqs` and `/site/:slug/faqs` |
| `src/orders` | `Order`, `OrderItem` | Checkout, the customer's history, the owner's order desk |
| `src/knowledge` | `KnowledgeDocument` (+ the unmanaged `knowledge_embeddings`) | Embeddings over the catalog/FAQ/store profile, hybrid retrieval, and `/knowledge/status`+`/reindex` |
| `src/chatbot` | `ChatSession`, `ChatMessage`, `ChatbotSettings` | The storefront assistant: the LangGraph agent, its tools, `POST /site/:slug/chat`, and the owner's `/chat/*` dashboard |
| `src/advisor` | `AdvisorBrief`, `AdvisorInsight`, `AdvisorSettings` | The Daily AI Advisor: five signal collectors, the nightly-per-timezone brief, and the owner's `/advisor/*` dashboard |
| `src/suppliers` | `Supplier`, `PurchaseRequest`, `SupplierOffer`, `MailboxConnection` | The supplier book, the AI-drafted purchase request, the replies read into numbers, the ranked `/purchase-requests/*` desk, and `/mailbox/*` — sending as the owner through their own Gmail and reading the replies back |

Support modules: `src/auth` (tokens + guard), `src/ai` (`GeminiService`), `src/storage` (`CloudinaryService`), `src/mail`, `src/redis`, `src/database`, `src/common`.

`src/payments` is the one module still to be written ([context/features/payments.md](context/features/payments.md)); [TODO.md](TODO.md) tracks the remaining gaps, of which OTP verification having no attempt limit is the one that matters.

### The knowledge base

`src/knowledge` is the retrieval half of the chatbot epic ([context/features/chatbot.md](context/features/chatbot.md)), and it is deliberately a module of its own: it is a search service over the catalog and FAQ that the Daily AI Advisor will want too. Four rules carry it:

- **The vector column is not ORM-mapped.** TypeORM has no `vector` type and `synchronize: true` is still how the schema is applied, so the embedding lives in `knowledge_embeddings` — a table created by `KnowledgeVectorInitializer` and unknown to TypeORM. `synchronize` drops unrecognised columns from tables it owns but never touches a table it has not heard of. The side effect is that the app boots with or without pgvector; a missing extension degrades retrieval to lexical rather than breaking the API. Postgres runs `pgvector/pgvector:pg15`, not `postgres:15-alpine`.
- **A source write only flips a flag.** `KnowledgeSubscriber` marks a document stale through `event.manager` (so the mark lives or dies with the transaction), and `KnowledgeSweeper` — the project's first `@nestjs/schedule` job — composes and embeds out of band. Embedding on the write path would put a Gemini round trip inside "save product". A `contentHash` means a price edit re-composes and never re-embeds.
- **`KnowledgeComposer` is the authority on membership.** It applies the storefront predicates, and a `null` from it deletes the document. Composition must be **deterministic** — the content is hashed, so an unsorted many-to-many makes the hash flip and re-embeds the whole catalog every night.
- **Hits are pointers, not payloads.** `RetrievalService` returns a source id and a snippet; the caller loads the live row through the service that owns it. The index can be wrong; the answer cannot. `KNOWLEDGE_MIN_SCORE` is calibrated against `gemini-embedding-001` by measurement — re-measure it if the model changes.

### The chatbot

`src/chatbot` is the conversation, and it imports `KnowledgeModule` for retrieval; nothing there reaches back. Five rules carry it:

- **The model never supplies a tenant id.** `ChatToolsFactory` builds the tool set **per request**, with `storeId` and `userId` closed over from the URL slug and the verified token. No tool schema has a `storeId` field, so there is nothing to hallucinate and nothing a prompt injection hidden in a product description can overwrite. There is deliberately no cached, long-lived agent.
- **Every tool is a thin wrapper over an existing service** — `RetrievalService`, `PublicProductService`, `FaqService`, `CustomerOrderService`. A rule cannot drift between chat and the storefront, because there is only one copy of it.
- **Chat works without an account.** Neither route carries `JwtAuthGuard`; `ChatAuthResolver` does what it and `StoreScopeGuard` would have done, optionally. No header → anonymous. A header that does not verify → **401**, never a quiet demotion. A token for another store → 403. When nobody is signed in the two order tools are **absent**, not refused, and the stand-in `order_lookup_requires_sign_in` reaches no data.
- **`ChatResolution` is computed in code**, in `resolveOutcome`, from what the tools actually returned — never reported by the model. It is the input to the Advisor's demand mining, so it has to be true. The reply payload is likewise rebuilt from ids against live rows: a price the model typed is not a price the storefront renders.
- **No tool writes.** Not cancel, not add-to-cart, not change-address. Each has a route with its own validation and, for cancel, a status machine and a stock restore.

The rate limit is keyed on the **caller** (`userId`, else the request IP), not on `sessionId`: the session id comes from the client, so keying on it means omitting it opens a fresh counter every request.

### The owner's insights

The `/chat/*` dashboard reads the same rows and adds no conversation logic. Three rules carry it:

- **`GET /chat/unanswered` returns themes, not messages.** Fifty shoppers asking for earbuds type fifty sentences, and fifty rows is not a demand signal. `summarizeUnanswered` does the deterministic pass — normalise, drop stop words, sort the tokens, group — and it runs always. `ChatClusteringService` does the semantic pass nightly, writing its merge to `ChatMessage.clusterKey`, which is what pulls "earbuds", "airpods" and "سماعات لاسلكية" onto one line. **An unavailable embedding service costs a coarser grouping, never an error** — the read path calls no AI provider.
- **The question is found through `ChatMessage.questionId`.** The resolution lives on the *answer* and the text an owner needs is on the *question*, so the assistant row links back to the user row of its turn. Without it the feed would be a window function over the store's whole transcript.
- **`ChatInsightsService.listUnansweredThemes` is what the Daily AI Advisor calls**, and the reason this shipped before the Advisor. Store-scoped, reviewed rows excluded, ordered by occurrences; the Advisor turns a row into a sentence and never reads `ChatMessage` itself.

`ChatbotSettings` is one row per store, created lazily and **only on the dashboard's own read** — a shopper's first message must not write one, so a missing row reads as the defaults. `isEnabled: false` makes `POST /site/:slug/chat` a 404 worded exactly like an unmatched route. `tone` is an enum rather than free text because it is concatenated into a system prompt.

`ChatMaintenanceService` is the nightly cron: the clustering pass, then retention — sessions idle for `CHAT_RETENTION_DAYS` (180) are deleted with their messages by the FK cascade. It runs on the same schedule as `KnowledgeSweeper.reconcileAll` rather than inside it, because the module dependency runs one way only.

### The Daily AI Advisor

`src/advisor` is the reader. It imports `OrdersModule`, `CatalogModule`,
`ChatbotModule` and `AiModule`, and **nothing imports it** — it is the leaf of
the dependency graph, and keeping it there is what stops the next feature from
reaching into a brief instead of into the signal it actually wants. Five rules
carry it:

- **Every number is measured; the model only writes the sentences.** Collectors
  produce `AdvisorSignal`s carrying the arithmetic, `rankInsights` picks the
  eight that matter, and `AdvisorNarrator` rewrites the wording — it is never
  asked for a quantity, a percentage, an id or a date. `buildFallbackSentence`
  has a case for every `AdvisorInsightKind`, so a Gemini outage costs polish and
  the row records `narratorStatus: fallback`. Money is **formatted before the
  model sees it**: the payload is minor units, and a model handed `1137100`
  writes "1137100 EGP".
- **Sales come from `order_items`, not from an `InventoryEvent` log.** The
  predicate that defines a sale (`status <> 'cancelled'`) is an orders rule, so
  the query lives in `OrderAnalyticsService` inside `src/orders`. An event table
  becomes necessary the day stock moves for a reason that is not an order —
  which is the supplier feature's problem.
- **A failed collector loses its section, never the brief.** They run under
  `Promise.allSettled`. If *every* one produces nothing, no row is written and
  no mail is sent: a daily "nothing to report" is the notification that teaches
  an owner to ignore the rest.
- **`dedupeKey` is derived from the thing, never from the wording** — the prose
  changes every run. It makes a regeneration keep the status the owner set,
  keeps dismissed advice out of the next `INSIGHT_SUPPRESSION_DAYS` of briefs,
  and is deliberately *not* consulted for today's own brief: a regeneration
  deletes and rewrites today's insights, so suppressing a line dismissed at
  09:00 would erase the only record that it was dismissed.
- **The scheduler is hourly and the unique index is the guarantee.** "7am" is
  three different instants in Cairo, Riyadh and Casablanca, so the cron wakes up
  every hour and asks each live store what time it is there.
  `UQ_advisor_briefs_store_date` on `(storeId, briefDate)` — a **local**
  calendar day — is what makes a double run safe; the Redis lock only saves the
  duplicated work.

The calendar signal needs no API: Ramadan and both Eids come from Node's own ICU
(`en-u-ca-islamic-umalqura`), and the weather comes from Open-Meteo, which needs
no key. Both sit behind the same kind of port `EmbeddingProvider` does. A store
with no coordinates gets no weather section **and makes no outbound request**.

### Suppliers and purchase requests

`src/suppliers` is the other end of the Advisor's restock line — it says
"reorder 18 units", and this turns that into a deal. **Nothing imports it, and
it does not import `AdvisorModule`**: the link is the dashboard, because the
restock insight's payload already carries `variantId` and a recommended
quantity. Five rules carry it:

- **The comparison is arithmetic, not an opinion.** `rankOffers` is a pure
  helper: on-time before late, then `unitAmount × quantity`, then delivery, then
  age. `isCheapest` and `isFastest` are flagged **separately** from
  `isRecommended`, so an owner can see when the recommendation is neither. An
  offer with no price is unrankable (`rank: null`) rather than last-with-a-zero
   — a supplier who has not answered is not a deal worth nothing.
- **The model reads and writes; it never converts.** It is asked for a price in
  **major** units — it reads "249 EGP each" and returns `249` — and
  `sanitizeExtractedOffer` multiplies. A model asked for minor units returns
  `249` anyway, and that is a hundredfold error in the one table an owner spends
  money from. The same rule in the other direction gave the Advisor its
  `formatMoney`.
- **Both AI calls degrade.** `buildFallbackRequestEmail` is a complete email, so
  a failed draft still sends and the row records `draftStatus: fallback`; a
  failed extraction stores `rawReply` with `extractionStatus: failed` and the
  owner types the three numbers into `PATCH …/offers/:offerId`. The raw reply is
  written **before** the model is called.
- **Replies arrive by paste, and `SupplierReplyService.ingest` is the seam.** An
  IMAP poller or a provider webhook would be a second caller of that one method;
  that is why the transport was left out rather than half-built.
- **`PurchaseRequestService` is the only writer of the request's status**, and
  the recipient list *is* the offer list — sending creates one `awaiting`
  `SupplierOffer` per supplier and mails only the ones whose `sentAt` is null,
  which is what makes `POST /send` idempotent. `confirm` writes conditionally on
  the status it read (a lost race is a 409) and mails **after** the transaction:
  a decline that bounces is a logged warning, never a rolled-back deal.

`Supplier` is soft-deleted and the offer snapshots `supplierName`/`supplierEmail`,
so removing a supplier keeps last quarter's deals readable. `totalAmount` is
deliberately not a column. One drafted body goes to every recipient — the
greeting is added per supplier by the mail template.

### The owner's mailbox

`src/suppliers/mailbox/` is the other end of `ingest`: requests are sent **as the
owner** through their own Gmail, so a supplier's reply lands in their inbox and a
cron reads it back. It is phase 2 of
[suppliers-purchasing.md](context/features/suppliers-purchasing.md#phase-2--automatic-ingestion-through-the-owners-gmail),
and it sits inside `SuppliersModule` rather than in a module of its own — there is
one caller and nothing else may reach a mailbox. Six rules carry it:

- **The paste route is never deleted.** It is the fallback for a revoked grant, a
  non-Gmail owner, and the week the Google assessment is in review. Every store
  with no connection is on it, and that is a supported way to run this rather than
  a degraded one — which is what makes "we lost access" an ordinary state.
- **Reading is a watermark, never a search.** `MailboxProvider` has no method that
  could search an inbox: `fetchReplies` takes the thread ids we opened and an
  opaque `cursor`. `gmail.readonly` is a **restricted** scope — the grant is total,
  so the usage has to be visibly narrow. `gmail.modify` is deliberately absent, and
  only stores with an open `sent`/`replied` request are polled at all.
- **The cursor advances after the commit, and not at all on an unexpected
  failure.** Saving it first would skip a supplier's reply permanently. But a
  reply that can *never* apply — its request was confirmed between the send and
  the answer — is a deliberate skip rather than a failure, or it would pin the
  cursor and re-read the same page every ten minutes.
- **`stripQuotedReply` runs before the extractor, and it is not cosmetic.** A
  reply quotes the request beneath it, and that request is a letter we wrote naming
  the quantity we asked for. Fed whole to Gemini it comes back as the supplier's
  offered quantity. `isReplyAlreadyRead` guards the same numbers from the other
  side: an expired watermark re-reads a thread from its first message, so an older
  quote must not walk back over a newer one.
- **`Reply-To` is omitted on the mailbox path** — the `From` is the mailbox being
  polled, and a `Reply-To` pointing at some other address of the owner's would
  route the reply where nothing can see it. The SMTP path still sets it, because
  there it is the whole return path.
- **The refresh token is the one credential here belonging to somebody outside the
  company.** AES-256-GCM under `MAILBOX_TOKEN_ENCRYPTION_KEY`, in a
  `select: false` column, never in a DTO, a log line or `lastError`. Rotating the
  key makes every grant unreadable — those rows read `expired` (ours) rather than
  `revoked` (Google's) and the owners reconnect.

The persisted names are **provider-neutral** — `mailbox_connections`,
`mailboxThreadId`, `syncCursor` — because Outlook (Graph) and IMAP go behind the
same port, and `historyId` is the one concept they do not share. `GmailProvider`
is bound to `MAILBOX_PROVIDER` in `SuppliersModule` and that binding is the only
place Gmail is named. It uses plain `fetch` over four endpoints plus the
already-installed `google-auth-library`; there is no `googleapis` dependency, for
the reason `OpenMeteoWeatherProvider` has no weather SDK.

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
- `CatalogSearchInitializer` is an `OnModuleInit` running `CREATE EXTENSION`/`CREATE INDEX … IF NOT EXISTS` for the search stack, because `synchronize` cannot express either. It is a **migration-era stopgap**: when migrations land its statements become the first migration and the class is deleted. Anything added there must be idempotent and must fail soft. `KnowledgeVectorInitializer` is the second of these, and the same rules apply.
- `ScheduleModule.forRoot()` is registered in `AppModule` for `KnowledgeSweeper`, `ChatMaintenanceService`, `AdvisorScheduler` and `MailboxSyncService`. A queue was considered and rejected for all of them: the work is state in a table rather than a message, so a missed run is picked up by the next one and there is nothing to lose or retry. Each takes a Redis lock so two instances do not both run it. `MailboxSyncService` additionally returns early when the feature is unconfigured, so a deployment with no client secret makes no outbound call at all.
- `KnowledgeModule` exports `EMBEDDING_PROVIDER` as well as `RetrievalService`, because the chatbot's unanswered clustering embeds question *themes* rather than documents. The port is what makes that possible without a second model or a second key.

### Auth flow

[src/auth/token.service.ts](src/auth/token.service.ts) owns all token logic:

- Access token: signed with `JWT_ACCESS_SECRET`, stateless.
- Refresh token: carries a random `jti`; its SHA-256 hash is stored at Redis key `refresh:<userId>:<jti>` with a TTL derived from the token's own `exp`. `rotateRefreshToken` verifies, compares the hash, **deletes the key**, and issues a fresh pair — refresh tokens are single-use, and replay fails.
- `JwtAuthGuard` is a hand-rolled `CanActivate` (no passport). It parses `Authorization: Bearer <token>` and assigns `request.user`. Apply per-route with `@UseGuards(JwtAuthGuard)`; read the payload with `@CurrentUser()` ([src/common/decorators/current-user.decorator.ts](src/common/decorators/current-user.decorator.ts)). The `Request.user` augmentation lives in [src/common/types/express.d.ts](src/common/types/express.d.ts).

### Google Sign-In

`POST /users/google` (a shopper, against a slug) and `POST /users/google/owner` (a platform account, against nothing) — one more pair in a controller made of pairs, and the reply is byte-for-byte the `LoginResponseDto` the password routes return, so the frontend keeps one session code path. **Identity only**: `openid email profile`, no client secret, and no Google token of any kind is ever stored. The supplier feature's Gmail access is a restricted scope on the **same Cloud client** and lives in `src/suppliers/mailbox/` — it holds the client secret and stores an encrypted refresh token, and the two must not be confused: see [context/features/google-oauth.md](context/features/google-oauth.md#not-this-feature) and *The owner's mailbox* above. One consequence is worth knowing: because the client is shared, `DELETE /mailbox` deliberately does **not** call Google's revoke endpoint, which would take the owner's login with it. Four rules carry it:

- **`GoogleTokenVerifier` verifies; it never decodes.** `jwt.decode()` on an ID token is a security hole with a friendly name — anyone can mint that JSON. It lives in `AuthModule` beside `TokenService` because it is the same kind of thing (a credential becoming a verified claim, touching no table), and the check that matters most is **`aud`**: without it, a token minted for any other Google app is account takeover with extra steps. A failed JWKS fetch is a **503**, an unusable token a **401** worded identically for every cause.
- **`sub` is the identity; the email is only a hint.** `User.googleId` holds `sub` and is what a returning user is found by — a Workspace user can change their address, so a lookup by email would hand the account to whoever holds it next. Uniqueness mirrors the email indexes exactly (`UQ_users_google_platform`, `UQ_users_google_store`): one platform account, one account per store shopped at.
- **`resolveGoogleAccount` is the linking rule, and it is pure.** googleId hit → login; else `email_verified: false` → **refuse**, before either remaining branch; else an email hit → **link** (a link, not a swap: the password keeps working and the role is untouched); else create. Linking on a verified address grants nothing that `forgot-password` did not already grant. Linking on an unverified one grants everything, to anyone who can make a Google account claiming it.
- **`User.password` is nullable, so every reader copes.** `login` treats a null hash as ordinary bad credentials — **401, never a 500 and never a hint the account exists**; `changePassword` is a 400 naming the reason; `resetPassword` is **allowed**, because the OTP proves the mailbox and adding a password to a Google account is legitimate. `authProvider` records only where a row came from and is **never a permission check** — the column that answers "can this account use a password" is `password IS NOT NULL`.

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

- `npm test` runs Jest over `src`. **Pure helpers are unit-tested; services and controllers are not** — the rules that would otherwise only be reachable through a database are extracted into `utils/` functions and tested there (`buildUniqueSlug`, `assertVariantMatrix`, `buildSearchQuery`, `sanitizeGeneratedCatalog`, `calculateTotals`, `assertTransition`, `summarizeUnanswered`, `clusterThemes`, …). Follow that when adding a rule worth trusting.
- Endpoints are verified against a running server with an API client per [context/ai-interactions.md](context/ai-interactions.md), scripted per branch; `npm run build` must pass before anything is committed.
- `src/app.controller.spec.ts` fails — it does not provide `ConfigService` for `AppService`. Pre-existing and unrelated to any feature branch.

## Notes

- `README.md` is the untouched NestJS starter README — it describes nothing project-specific. [SETUP.md](SETUP.md) is the real one, written for the frontend team.
- `npm run seed -- --force` wipes the database and refills it with three stores, seven accounts, the full catalog, FAQ entries and orders, then prints access tokens and row ids. It refuses to run outside `NODE_ENV=development`.
- CORS comes from the validated `CORS_ORIGINS` allowlist. No `@nestjs/swagger` and no global prefix — routes are exactly what the controllers declare.
