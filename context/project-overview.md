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
- Google OAuth — planned.

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
| Auth | Hand-rolled JWT guard (`@nestjs/jwt`), bcrypt, rotating refresh tokens |
| Mail | Nodemailer |
| Validation | class-validator + class-transformer, global `ValidationPipe` |
| AI | Gemini |
| Testing | Jest (unit) + Supertest (e2e) |
| Local infra | Docker Compose — Postgres, Redis, Adminer |

Not chosen yet: file/image storage, background jobs & scheduling, vector store
for the chatbot RAG, inbound-email provider, deployment target, monitoring.

---

## 🗄️ Domain Model (rough draft — will evolve)

Only `User` exists today. The rest is the intended shape, not implemented code.

- **User** — `id (uuid)`, `firstName`, `lastName`, `image (nullable)`, `email`,
  `password (select: false)`, `role (OWNER|ADMIN|USER)`, `isEmailVerified`,
  timestamps. ✅ implemented
- **Store** — owner, name, slug (the `SITENAME` path segment, unique),
  status (`draft|live`), locale.
- **Brand / Theme** — per store and versioned: logo asset, description, colors,
  fonts, layout, plus the questionnaire answers that produced it.
- **Product** — store, title, description, images, price, SKU, stock quantity,
  attributes (feeds custom filters).
- **Filter** — store-defined facet definition + values, layered over defaults.
- **Order / OrderItem** — store, customer, items, totals, status.
- **Customer** — a storefront buyer, distinct from a platform `User`.
- **Supplier** — store, contact email, delivery-time estimate, owner notes.
- **PurchaseRequest / Offer** — request lifecycle plus each supplier's extracted
  price, quantity and delivery time.
- **InventoryEvent** — the sales/stock movement log the forecasts read from.
- **ChatSession / ChatMessage** — chatbot transcripts, including the unanswered
  questions the Advisor mines.
- **AdvisorBrief** — a generated daily brief and its recommendations.

---

## 🧭 Roadmap

**Done**

- Project setup, typed & validated env config, TypeORM/Postgres, Docker Compose.
- Auth: register (owner/user), login, JWT access + rotating single-use refresh
  tokens, email verification and password reset via OTP.

**Next (MVP)**

- Close the unverified-account lockout gap ([TODO.md](../TODO.md)).
- Role guard — `OWNER`/`ADMIN` routes are unprotected by role today.
- Store entity, multi-tenancy scoping, slug resolution (`/SITENAME` → store).
- Products, filters, orders — CRUD + storefront read endpoints.
- Image/file uploads.

**Then**

- AI site builder: questionnaire → Gemini → theme generation and partial
  regeneration.
- Smart inventory: event log, demand forecasting, low-stock alerts.
- Supplier flow: drafted emails, reply parsing, offer ranking.
- Chatbot multi-RAG.
- Daily AI Advisor with scheduling and external signals (calendar, weather).
- Google OAuth.

**Later**

- Migrations (dev currently relies on `synchronize: true`).
- Rate limiting, monitoring, Swagger/OpenAPI.
- Arabic/English i18n.
- Billing and plan limits.

---

🏗️ **InventoAI — Launch Smarter. Stock Better.**
