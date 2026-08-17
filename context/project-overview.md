# InventoAI — Project Overview

> **Purpose of this file:** product context for the backend. It answers *what
> we're building and why*, so features can be implemented without re-explaining
> the domain every session. It is **not** a code map — architecture, module
> wiring and conventions live in [CLAUDE.md](../CLAUDE.md); coding rules live in
> [coding-standards.md](./coding-standards.md); the task in flight lives in
> [current-feature.md](./current-feature.md).

🚀 **AI-Powered E-commerce Builder with Smart Inventory.**

A SaaS platform that lets a business owner launch a hosted online store in
minutes, then uses AI agents to predict demand, optimize stock, and run supplier
purchasing on their behalf.

**This repository is the backend only**: a NestJS REST API. The storefront,
admin dashboard and onboarding UI are separate frontend clients that consume it.

---

## 📌 Problem

Small and medium businesses struggle with two separate problems:

1. **Inventory is guesswork.** Owners don't read demand patterns, so they
   overstock slow movers and run out of the products that actually sell. The
   cost is tied-up cash, lost sales, and a bad customer experience.
2. **Going online is a technical wall.** Plenty of owners have products to sell
   but no way to design a brand, build a store, or configure e-commerce.

InventoAI collapses both into one platform: an AI-assisted store builder on top
of a smart inventory system that forecasts demand, triggers restocks, and
negotiates with suppliers.

---

## 🧑‍💻 Users

**Primary**

- Small and medium business owners launching and running an online store.
- Entrepreneurs with products to sell but no technical expertise.

**Secondary**

- Suppliers, who receive purchase requests and reply by email.
- End customers, who browse and buy from stores built on the platform.

**Characteristics**

- Mostly non-technical.
- Target region: Egypt and MENA first, usable globally.
- Languages: English and Arabic.

**Implication for the API:** the backend is **multi-tenant**. Nearly every
resource (products, orders, suppliers, themes, chat logs) is scoped to a store,
and every query must be filtered by the store the caller belongs to. Roles today
are `OWNER | ADMIN | USER` (`UserRole`); an owner may create admins for their
own store.

---

## 💡 Proposed Solution

The owner answers a short questionnaire about their business. The AI generates
branding — logo, store description, and a full theme (colors, fonts, layout) —
and stores it as structured data. The frontend renders any store from that data
at a **path-scoped route**, not a subdomain:

| Frontend route | Backend supplies |
| --- | --- |
| `inventoai.com/SITENAME` | landing-page details for that store |
| `inventoai.com/SITENAME/products` | that store's products page |
| `inventoai.com/SITENAME/faq` | that store's FAQ list |

The owner previews it, asks the AI to regenerate individual pieces ("new logo",
"different colors"), adds products, and launches.

From there the smart inventory module takes over: it tracks sales and stock,
analyzes demand, recommends restock quantities, drafts supplier emails, reads
the replies, and ranks the offers.

---

## ✨ Core Features

### 1. AI Site Builder

1. Sign up and answer questions — business name, type, audience, brand
   personality, preferred colors.
2. AI generates the brand — logo, store description, theme (colors, fonts,
   layout).
3. Store is generated — the theme is saved as structured data the frontend
   renders at `inventoai.com/SITENAME`. There is **no pre-built template** for
   the MVP: the backend serves page data + theme, the frontend does the
   rendering.
4. Owner previews the live result.
5. AI revises on request, regenerating only the requested part.
6. Owner adds products and prices, then activates the store.

**Backend responsibility:** persist the questionnaire, call Gemini, store the
generated theme/branding as structured data (not rendered HTML), version it so
regeneration is partial and reversible, host logo/image assets, and resolve the
store slug (`SITENAME` in the URL path) → store.

### 2. Smart Inventory

Tracks every sale and current stock level, predicts demand, and warns before a
product runs out. Feeds the restock and supplier flows below.

### 3. Storefront

Home, Products listing, Single Product, Cart, Checkout, FAQ — served as API
endpoints for the storefront client, scoped by store. The client reaches them
under `inventoai.com/SITENAME/...`, so every storefront endpoint takes the store
slug and returns only that store's data.

**Search** is part of this surface and is built to be good, not incidental:
results ranked by relevance with title matches beating description matches,
stemming (`running` finds "Run"), prefix matching for as-you-type suggestions,
and typo tolerance (`popcorm` still finds the popcorn machine). It runs on
Postgres full-text search plus `pg_trgm` — no Elasticsearch, no second
datastore. Specified in
[features/products.md](./features/products.md#search).

### 4. Admin Dashboard

- Edit home page images and text.
- Regenerate the site.
- **Custom filters** — every store needs different facets (color, size, …), so
  filters are owner-defined data on top of a shared default set
  (e.g. availability, price). This must not be hardcoded per store.
- Manage products.
- Manage orders.
- Manage providers/suppliers — add, delete, and attach notes ("they deliver
  late") that the AI negotiator takes into account.
- Statistics.
- Daily AI Advisor page.

### 5. User Profile

- Update basic profile data (details, profile image).
- Change password.
- Owner can create admin accounts (email + password) for their store — as many
  as they need, so staff can help run the e-commerce with them.

### 6. Storefront Chatbot (multi-RAG)

Routes a customer message to the right source and answers in-chat:

| Message | Behaviour |
| --- | --- |
| "I need a toy for my 5-year-old girl" | Returns matching product cards from the store's catalog |
| "Has my order shipped yet?" | Returns live order status + link to the order |
| "Can I return a product I bought 3 weeks ago?" | Answers from the store's FAQ, citing the exact policy |
| "1 + 1 = ?" | Stays on topic: "Hi, I'm your store helper — how can I assist you?" |

Unanswered questions are logged — they feed the Advisor's demand mining.

### 7. Authentication

- Email + password with access/refresh tokens — **implemented**.
- Google OAuth — specified, not built
  ([features/google-oauth.md](./features/google-oauth.md)). Identity only
  (`openid email profile`); the supplier feature's Gmail access is a separate,
  restricted grant and a separate branch.

### 8. The Daily AI Advisor

A scheduled brief combining several signals:

- **Calendar & events** — Ramadan, Eid, back-to-school, national matches.
- **Weather** — a heatwave next week pushes cold drinks and summer wear up.
- **Sales trends** — velocity and seasonality, not just today's row count.
- **Smart restock trigger (agent)** — reorders before stock-out, factoring in
  each supplier's delivery time.
- **Unanswered-question mining** — learns from chatbot logs what customers ask
  for that the store doesn't stock.

Example brief:

> Ramadan starts in 3 weeks — last year your dates & lanterns sold out right
> about now. Stock up early.
> Heatwave forecast this week — move cold drinks & summer wear to your homepage.
> "Teddy Bear XL" is selling 3× faster than last month.
> → Reordering 60 units now to beat the supplier's 10-day delivery.
> 45 customers asked the chatbot for "wireless earbuds" — you don't sell them
> yet. Consider adding.

### 9. From "Low Stock" to "Deal Closed"

1. AI drafts purchase-request emails and sends them to suppliers.
2. AI reads the replies, extracting price, quantity and delivery time.
3. AI ranks the offers side-by-side in the dashboard.
4. AI suggests renegotiating when a price is out of line.
5. Owner picks the deal.
6. System emails the winning supplier to confirm, and politely declines the
   rest.

**Backend responsibility:** outbound mail, inbound reply ingestion and parsing,
an offer entity with extracted fields, and a state machine for the request
lifecycle (`drafted → sent → replied → ranked → confirmed / cancelled`).

> AI powered by **Gemini**.

---

## 🧱 Tech Stack

| Category | Choice |
| --- | --- |
| Framework | **NestJS 11** |
| Language | TypeScript — `strictNullChecks` on, `noImplicitAny` off (NestJS defaults) |
| Database | PostgreSQL + **TypeORM** |
| Cache / ephemeral state | Redis (`ioredis`) — refresh tokens, OTPs |
| Catalog search | Postgres full-text (`tsvector` + GIN) with `pg_trgm` for typo tolerance — no external search service |
| Auth | Hand-rolled JWT guard (`@nestjs/jwt`), bcrypt, rotating refresh tokens |
| Mail | Nodemailer |
| Image storage | Cloudinary (`CloudinaryService`) — logos, hero, category and product images |
| Validation | class-validator + class-transformer, global `ValidationPipe` |
| AI | Gemini |
| Testing | Jest (unit) + Supertest (e2e) |
| Local infra | Docker Compose — Postgres, Redis, Adminer |

Not chosen yet: background jobs & scheduling, vector store for the chatbot RAG
(`pgvector` in the existing Postgres vs. MongoDB Atlas — the deciding question is
multi-tenant filtering and keeping embeddings fresh, not retrieval quality),
inbound-email provider, deployment target, monitoring.

---

## 🗄️ Domain Model (rough draft — will evolve)

✅ marks an entity that exists in code. The rest is the intended shape.

- **User** ✅ — `id (uuid)`, `firstName`, `lastName`, `image (nullable)`,
  `email`, `password (select: false)`, `role (OWNER|ADMIN|USER)`,
  `storeId (nullable — null for OWNER)`, `isEmailVerified`, timestamps.
- **Store** ✅ — owner, name, slug (the `SITENAME` path segment, unique),
  status (`draft|live`), locale, currency, `nextOrderNumber`.
- **Brand / Theme** ✅ — `StoreTheme` and `SiteBuildDraft`: logo asset,
  description, colors, fonts, layout, plus the questionnaire answers that
  produced it.
- **Category** ✅ — store-scoped, `isFeatured`, owner-controlled `position`.
- **ProductAttribute / ProductAttributeValue** ✅ — the store-defined facets
  that replaced the **Filter** entity this draft first sketched. Each attribute
  carries a display style and `isVariantAxis`; values are a controlled list, not
  free text.
- **Product / ProductVariant / ProductImage** ✅ — store, title, description,
  images, and per-variant SKU, price and stock. Every product has at least one
  variant, so "3 left in M" is expressible. `Product` also carries a generated
  `tsvector` and four aggregates denormalised from its variants.
- **Faq** ✅ — store-scoped question/answer pair, `position`, `isPublished`.
  Hard-deleted, unlike `Category` and `Product`: nothing references it.
- **Order / OrderItem** ✅ — store, buyer, items, totals, and two independent
  states: `status` (fulfilment) and `paymentStatus` (money). Per-store
  `orderNumber`, contact details and address snapshotted so an order renders
  after the account is gone. `OrderItem` snapshots title, slug, image, SKU,
  price and the option **labels** at purchase time, so repricing, renaming or
  deleting a product never rewrites history. Never deleted, only cancelled.
- **Customer** — **superseded**: a storefront buyer is a store-scoped `User`
  with `role = USER`, not a separate entity. Kept here only to record the
  decision ([ecommerce-core.md](./features/ecommerce-core.md)).
- **Supplier** — store, contact email, delivery-time estimate, owner notes.
- **PurchaseRequest / Offer** — request lifecycle plus each supplier's extracted
  price, quantity and delivery time.
- **InventoryEvent** — the sales/stock movement log the forecasts read from.
- **ChatSession / ChatMessage** — chatbot transcripts, including the unanswered
  questions the Advisor mines.
- **AdvisorBrief** — a generated daily brief and its recommendations.

---

## 🧭 Roadmap

Per-feature detail and commits live in
[current-feature.md](./current-feature.md); this is the altitude view.

**Done**

- Project setup, typed & validated env config, TypeORM/Postgres, Docker Compose,
  CORS allowlist.
- Auth: register (owner/user), login, JWT access + rotating single-use refresh
  tokens, email verification and password reset via OTP, resend with a cooldown.
- Users scoped to a store — nullable `User.storeId`, per-store registration and
  login, `storeId` in the JWT. Closes the unverified-account lockout gap.
- `RolesGuard` and `StoreScopeGuard`.
- **AI site builder** — questionnaire → Gemini → branding and theme, partial
  regeneration, `Store`/`StoreTheme`/`SiteBuildDraft`, and the public
  `GET /site/:slug` the storefront renders from.
- Image uploads via Cloudinary.
- **Catalog** — owner-managed categories; store-defined product attributes with
  controlled value lists and display styles; **products, variants, images and
  stock**, the storefront listing with owner-defined facets, and the ranked,
  stemmed, typo-tolerant Postgres search described above. The landing page now
  carries both its featured strips.
- **AI catalog setup** — one Gemini generation proposing a store's categories,
  attributes, values and display styles from the questionnaire it already
  answered; the owner reviews and edits before anything is written, and applying
  twice duplicates nothing.
- **FAQ** — owner-managed, ordered, publishable entries and the storefront's
  `/SITENAME/faq` page. Plain text, deliberately: no sanitiser in the project,
  so no HTML from the database.
- **Orders** — checkout for a store's registered customer (the server re-prices
  every line and reserves stock atomically, so nothing can be oversold or bought
  at a price the client chose), immutable order snapshots, the customer's own
  history, and the owner's dashboard with the fulfilment status machine, its
  stock restore and the cash-on-delivery `paid` flip. **COD only** until
  payments land.
- Dev seed script and [SETUP.md](../SETUP.md) for the frontend team.

**Next (MVP)** — the rest of the
[e-commerce core](./features/ecommerce-core.md) epic, in branch order:

- **Payments** — card via a provider port, Paymob assumed. It layers onto the
  order flow that already works rather than changing it.
- Owner-managed admin accounts ([TODO.md](../TODO.md)) — `ADMIN` exists as a
  role, but nothing creates one yet.
- Attempt limits on OTP *verification* — unlimited guesses at a 6-digit code is
  account takeover on the reset-password path ([TODO.md](../TODO.md)).

**Then**

- Smart inventory: event log, demand forecasting, low-stock alerts.
- Supplier flow: drafted emails, reply parsing, offer ranking.
- Chatbot multi-RAG — needs the vector-store decision above.
- Daily AI Advisor with scheduling and external signals (calendar, weather).
  The scheduling story it needs also unblocks reaping abandoned unverified
  accounts ([TODO.md](../TODO.md)).
- Google OAuth ([features/google-oauth.md](./features/google-oauth.md)), which
  is also the prerequisite that turns the supplier feature's Gmail ingestion
  into an incremental consent rather than a cold ask.

**Later**

- Migrations (dev currently relies on `synchronize: true`). This is also what
  retires the boot-time DDL initializer the catalog search index needs.
- Rate limiting, monitoring, Swagger/OpenAPI.
- Arabic/English i18n.
- Billing and plan limits.

---

🏗️ **InventoAI — Launch Smarter. Stock Better.**
