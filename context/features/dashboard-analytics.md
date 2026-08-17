# Dashboard analytics — the owner's numbers

> "Statistics" in the Admin Dashboard list of the
> [project overview](../project-overview.md), feature 4. The last unbuilt item
> on that list once [admin accounts](./admin-accounts-rbac.md) ship.
>
> **A reader, like the Advisor.** No new table, no new dependency, no AI, and
> no storefront surface. It answers questions the database can already answer,
> and says plainly which questions it cannot.

## Overview

The Daily AI Advisor already turns the store's data into eight sentences a
morning. This is the other half of the same coin: not "what should I do today",
but **"how is the shop doing"** — revenue over time, what sells, what is stuck
on a shelf, how many orders are waiting on the owner right now.

Everything it reports is derivable from tables that already exist:
`orders` + `order_items` for money and units, `product_variants` for stock,
`users` for customers, `chat_sessions` for how much the assistant is being
asked. The work is not gathering data. The work is **not lying about it** —
which is why the largest section below is the one about what this feature
refuses to compute.

## Goals

- KPI cards for a chosen period, each with its change against the previous
  period of equal length.
- A daily/weekly time series of revenue, orders and units, with **no gaps** — a
  day with no sales is a zero on the chart, not a missing point.
- Top products by revenue and by units, and the orders split by status.
- The inventory picture: out of stock, low stock, stock value, dead stock.
- New versus returning customers.
- Every figure scoped to the caller's store, and every amount in minor units.

## Non-goals — and this section is the specification

There is **no event log in this project**. Nothing records a page view, a
session, an add-to-cart or a search that led nowhere. So:

| Question an owner will ask | Can we answer it? |
| --- | --- |
| How much did I sell last month? | **Yes** — `orders` |
| Which product makes me the most money? | **Yes** — `order_items` |
| What is stuck on my shelves? | **Yes** — variants + last sale date |
| How many customers came back? | **Yes** — orders grouped by `userId` |
| What is my **conversion rate**? | **No.** Needs visits. We have none |
| Where does my traffic come from? | **No.** Needs a referrer, i.e. a beacon |
| How many people abandoned a cart? | **No.** The cart lives in the client — there is no `Cart` table by design |
| Which search terms found nothing? | **Partly.** The chatbot's unanswered feed knows; the storefront search box does not log |

**The API must not invent proxies for the four "no" rows.** "Sessions per order"
dressed up as a conversion rate is worse than an empty panel, because somebody
will make a decision with it. The honest fix — an `AnalyticsEvent` table and a
storefront beacon — is a feature of its own and is [deferred](#deferred).

Also out of scope: CSV/PDF export, scheduled email reports (the Advisor's brief
already is one), cohort/retention curves, profit (we store no cost price), and
tax breakdowns.

## Decisions

### 1. The orders module owns what a sale *is*; analytics only shapes it

`OrderAnalyticsService` already exists in `src/orders` and exists precisely for
this reason: the predicate that defines a sale — `status <> 'cancelled'` — is an
orders rule, and a second copy of it in `src/analytics` is a rule that can
drift. The Advisor made this call first; analytics inherits it.

```
   src/analytics                    src/orders
  ┌───────────────────┐            ┌──────────────────────────────┐
  │ AnalyticsService  │──reads────▶│ OrderAnalyticsService        │
  │  shapes DTOs,     │            │  owns every ORDER predicate  │
  │  computes deltas, │            │  (what counts as a sale,     │
  │  fills buckets    │            │   what counts as paid)       │
  └───────────────────┘            └──────────────────────────────┘
           │                        ┌──────────────────────────────┐
           └──reads────────────────▶│ ProductService.listStockLevels│
                                    └──────────────────────────────┘
```

New SQL lands in `OrderAnalyticsService`, not here. `AnalyticsService` contains
arithmetic and shaping and **no `WHERE status`**.

### 2. A "day" is a day in the store's own timezone

`date_trunc('day', "createdAt")` in UTC cuts a Cairo shop's day at 02:00 and
moves an evening's orders onto tomorrow. Every bucket is therefore computed
`AT TIME ZONE` an IANA zone:

```sql
date_trunc('day', o."createdAt" AT TIME ZONE :timezone)
```

Where the zone comes from is the one awkward part: it currently lives on
`AdvisorSettings.timezone`, and **nothing may import `AdvisorModule`** — it is
the leaf of the graph and stays there. So for now the client sends it:
`?timezone=Africa/Cairo`, validated with `@IsTimeZone()`, defaulting to
`ADVISOR_DEFAULT_TIMEZONE` (a constant import, which is what
[suppliers](./suppliers-purchasing.md) already does for the lead-time default).

**The real fix is `Store.timezone`**, with `AdvisorSettings.timezone` becoming an
override — recorded in [deferred](#deferred), because moving a column that the
Advisor's scheduler depends on is not this feature's business.

### 3. Gaps are filled in code, not in SQL

`GROUP BY day` returns only the days that had orders. A chart drawn from that
compresses a quiet fortnight into a straight line between two points and lies
about the shape of the business.

`fillDateBuckets({ from, to, interval, rows })` is a **pure helper with unit
tests** — the project's habit for exactly this kind of rule — which walks the
requested range in the requested timezone and emits a zero for every bucket the
query did not return. `generate_series` could do it in Postgres; a tested
function that also guarantees the chart's length equals the range is cheaper to
trust and easier to assert.

### 4. Deltas are computed, never formatted

Every KPI carries its previous-period value and the change as a **number**:

```jsonc
{ "revenueAmount": 1137100, "previousAmount": 902400, "changeRatio": 0.26 }
```

Not `"+26%"`, and not `"11,371 EGP"`. The API never returns a formatted amount —
the same rule the whole codebase follows, and the reason the Advisor's narrator
had to be handed pre-formatted money as a special case rather than by default.

`changeRatio` is `null` when the previous period is zero: growth from nothing is
not a percentage, and `Infinity` is not JSON.

### 5. Cached for a minute, and stale on purpose

A dashboard mounting six widgets fires six requests at once, each running two or
three aggregates over the same rows. A Redis key per store per query shape
(`analytics:<storeId>:<sha1 of the query>`) with `ANALYTICS_CACHE_SECONDS` (60)
collapses that to one pass.

**No invalidation.** An order placed 30 seconds ago being absent from a revenue
chart is not a correctness problem, and a cache that every checkout has to
invalidate is a coupling from `src/orders` to `src/analytics` — the wrong
direction and, for a number that changes all day anyway, bought for nothing.
The panel states the freshness (`generatedAt`) rather than pretending.

### 6. `src/analytics` is a leaf

It imports `OrdersModule`, `CatalogModule`, `ChatbotModule` and
`SiteBuilderModule`. **Nothing imports it**, exactly as with `src/advisor`: a
feature that wants a number must go to the service that owns it, never to a
dashboard endpoint.

## Auth & access control

| Surface | Rule |
| --- | --- |
| `/analytics/**` | `JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER, ADMIN)`, **plus `@RequirePermissions(AnalyticsRead)`** |

That permission is defined in [admin-accounts-rbac.md](./admin-accounts-rbac.md).
If this feature ships first, the decorator is simply absent and every admin sees
the numbers — which is today's behaviour for every other dashboard route.
Revenue is the most obvious thing an owner would want to withhold from staff, so
**the two features are better shipped in that order**: RBAC, then this.

Store scope is `StoreService.resolveCallerStore(user)`, as everywhere.

## Endpoints — `src/analytics/analytics.controller.ts`

All take the same `AnalyticsQueryDto` (`from`, `to`, `timezone?`), and all are
`GET`, cacheable, side-effect free.

| Method | Route | Returns |
| --- | --- | --- |
| `GET` | `/analytics/summary` | `AnalyticsSummaryDto` — the KPI cards + deltas |
| `GET` | `/analytics/timeseries` | `TimeSeriesDto` — `?metric=revenue\|orders\|units&interval=day\|week` |
| `GET` | `/analytics/top-products` | `TopProductDto[]` — `?sort=revenue\|units&limit=` |
| `GET` | `/analytics/orders-breakdown` | `OrdersBreakdownDto` — by status, payment status, payment method |
| `GET` | `/analytics/customers` | `CustomerStatsDto` — new vs returning, top buyers |
| `GET` | `/analytics/inventory` | `InventoryStatsDto` — stock health; ignores `from`/`to` |

Six endpoints rather than one fat `/overview`, because a dashboard renders the
cards immediately and lazy-loads the charts, and because a slow inventory query
must not delay the revenue number.

### What each one holds

**`/analytics/summary`** — every field paired with its previous-period value:

```
revenueAmount        sum(totalAmount)  where status <> cancelled
orderCount           count(*)          same predicate
averageOrderAmount   revenue / orders  (integer division, minor units)
unitsSold            sum(order_items.quantity)
newCustomerCount     users whose FIRST order falls in the period
cancelledCount       + cancellationRatio
pendingCount         orders sitting in `pending` right now (not period-scoped)
```

`pendingCount` is deliberately **not** period-scoped: "12 orders are waiting for
you" is a to-do, not a statistic, and an owner reading a January report does not
want January's backlog.

**`/analytics/inventory`** — `outOfStockCount`, `lowStockCount`
(`stockQuantity <= lowStockThreshold`, the same predicate the catalog filter
uses), `stockValueAmount` (`Σ stockQuantity × priceAmount`, **at retail price —
we store no cost price**, and the DTO field says so), and `deadStock`: variants
with stock and no sale in `DEAD_STOCK_DAYS` (60), read through
`OrderAnalyticsService.findLastSoldAtByProduct`, which already exists for the
Advisor's slow-mover signal.

**`/analytics/customers`** — `newCustomerCount` / `returningCustomerCount` for
the period, and the top buyers by lifetime spend. A guest has no `userId`, so
the counts are of *registered* buyers; the DTO names the field
`registeredCustomers` rather than `customers` so nobody reads it as footfall.

## DTOs — `src/analytics/dto/`

| File | Shape |
| --- | --- |
| `analytics-query.dto.ts` | `from` / `to` (`@IsDateString()`, `to >= from`, range ≤ `MAX_RANGE_DAYS`), `timezone?` (`@IsTimeZone()`) |
| `timeseries-query.dto.ts` | extends it with `metric` (enum) and `interval` (enum) |
| `top-products-query.dto.ts` | extends it with `sort` (enum) and `limit` (`@Max(50)`) |
| `metric-dto.ts` | `{ value, previousValue, changeRatio }` — one shape reused by every KPI |
| `analytics-summary.dto.ts` | the seven KPIs, `currency`, `generatedAt` |
| `timeseries.dto.ts` | `{ interval, points: [{ bucket: 'YYYY-MM-DD', value }] }` — **length always equals the range** |
| `top-product.dto.ts` | `productId`, `title`, `slug`, `imageUrl`, `unitsSold`, `revenueAmount` |
| `orders-breakdown.dto.ts` | counts and amounts per `OrderStatus`, `PaymentStatus`, `PaymentMethod` |
| `customer-stats.dto.ts` | the counts + `topCustomers[]` |
| `inventory-stats.dto.ts` | the stock figures + `deadStock[]` |

`currency` is `Store.currency`, returned once per response. No amount is ever a
string.

**Top products read `order_items`, not `products`** — the snapshot, so a renamed
or deleted product still reports what it earned. `title` comes from the item's
`productTitle`, and `productId` may be null; that is the same rule the order
detail page follows.

## Queries — the two worth writing down

```sql
-- revenue per local day, zero-filled afterwards in Node
SELECT date_trunc('day', o."createdAt" AT TIME ZONE $tz) AS bucket,
       SUM(o."totalAmount")::int AS amount,
       COUNT(*)::int             AS orders
FROM orders o
WHERE o."storeId" = $storeId
  AND o.status <> 'cancelled'
  AND o."createdAt" >= $from AND o."createdAt" < $to
GROUP BY bucket
ORDER BY bucket;

-- top products, from the SNAPSHOT
SELECT i."productId", i."productTitle", i."productSlug",
       SUM(i.quantity)::int                    AS units,
       SUM(i.quantity * i."unitAmount")::int   AS revenue
FROM order_items i
JOIN orders o ON o.id = i."orderId"
WHERE o."storeId" = $storeId
  AND o.status <> 'cancelled'
  AND o."createdAt" >= $from AND o."createdAt" < $to
GROUP BY i."productId", i."productTitle", i."productSlug"
ORDER BY revenue DESC
LIMIT $limit;
```

Both live in `OrderAnalyticsService` (decision 1). Both need an index the schema
does not have yet:

```ts
@Index('IDX_orders_store_created', ['storeId', 'createdAt'])
```

`orders` currently has `UQ_orders_store_number`, `IDX_orders_store_status` and
`IDX_orders_user`; **every query in this feature filters store + date range**,
so this is the one schema change the feature makes, and it is additive.

## Constants — `src/analytics/analytics.constants.ts`

```ts
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;     // a year plus a leap day
export const MAX_TOP_PRODUCTS = 50;
export const DEAD_STOCK_DAYS = 60;
export const ANALYTICS_CACHE_SECONDS = 60;
export const ANALYTICS_CACHE_PREFIX = 'analytics:';
```

`MAX_RANGE_DAYS` matters: a `?from=1970-01-01` is either a mistake or a probe,
and either way it should be a 400 rather than a table scan.

## Implementation order

1. `IDX_orders_store_created` on `Order`.
2. `fillDateBuckets` and `calculateChangeRatio` as pure helpers **with their
   tests** — the zero-filling and the divide-by-zero are the two rules worth
   trusting.
3. `OrderAnalyticsService` gains the aggregates: `sumRevenueByBucket`,
   `summarisePeriod`, `topProductsByRevenue`, `countByStatus`,
   `countNewCustomers`.
4. `AnalyticsService` — composes, computes deltas, fills buckets, caches.
5. DTOs, then `AnalyticsController`.
6. `AnalyticsModule` in `AppModule`.
7. Add `@RequirePermissions(AnalyticsRead)` once
   [RBAC](./admin-accounts-rbac.md) exists.

## Seed

Nothing new to write: `seedOrders` already back-dates its fourteen orders across
the last two months (it had to, for the Advisor's velocity signals to mean
anything), which is exactly what a time series needs to look like a business
rather than a spike. One line to add to the seed report — a **analytics** line
per store naming the period covered and the revenue in it — so the numbers can
be checked against the endpoint by eye.

Worth knowing when verifying: `layali` has one cancelled order in the fixture,
so `revenue ≠ sum of all orders` is the *correct* result and the first thing to
assert.

## Tests

Unit:

- `fillDateBuckets` — a range with no rows returns all zeros of the right
  length; a row on the last day lands in the last bucket; `interval: week`
  buckets from the range start, not from Monday; a DST-shifting zone still
  yields one bucket per local day.
- `calculateChangeRatio` — `0 → 100` is `null`, not `Infinity`; `100 → 50` is
  `-0.5`; `0 → 0` is `null`.

Endpoint:

- The summary's `revenueAmount` equals the sum of the seeded non-cancelled
  orders, **excluding the cancelled one**, and `orderCount` matches.
- `averageOrderAmount × orderCount` is within rounding of `revenueAmount`.
- A range covering no orders → every KPI zero, `changeRatio: null`, 200.
- `timeseries` returns exactly `to - from + 1` points for `interval=day`, and a
  quiet day is present with `value: 0`.
- An order placed at 23:30 Cairo time lands on **that** day for
  `timezone=Africa/Cairo` and on the next for `timezone=UTC` — the decision-2
  check, and the one a UTC-only implementation fails.
- `top-products` names the product from the **snapshot**: rename the product,
  and last month's report still says the old title.
- Cancelling an order removes it from revenue and adds it to
  `orders-breakdown.cancelled`, in the same period.
- `inventory` counts the seeded out-of-stock variant, and `deadStock` lists the
  archived-but-stocked product rather than the fast mover.
- Store B's owner sees store B's numbers; no id from store A appears anywhere.
- An `ADMIN` sees what the `OWNER` sees (until RBAC lands); a `USER` 403s; no
  token 401s.
- `from` after `to` → 400; a 400-day range → 400; `timezone=Mars/Olympus` → 400.
- Two identical requests inside a minute produce identical `generatedAt` (the
  cache is doing its job), and a third after 60s does not.

## Considered and rejected

- **A materialised `store_daily_stats` rollup table.** The right answer at a
  volume this project will not see for years, and it brings a nightly job, a
  backfill, and a second source of truth that can disagree with `orders`. The
  60-second cache buys the same relief for none of the risk. It becomes right
  when a single aggregate stops being interactive — noted in
  [deferred](#deferred).
- **Computing a conversion rate from chat sessions or order counts.** There is
  no denominator. Any number here would be invented, and it is exactly the kind
  of number an owner would spend money on.
- **Putting these queries in `AnalyticsService`.** Decision 1 — the sale
  predicate belongs to `src/orders`, and a copy of it here is a rule that drifts
  the first time a `refunded` status is added.
- **Returning formatted money or percentages.** The API returns minor units and
  ratios; the dashboard formats. The Advisor is the one place that formats,
  because a *model* was reading the number.
- **Serving analytics to the storefront** ("500 people bought this"). A
  different audience, a different cache, and a privacy question this spec does
  not want to answer by accident.
- **Profit margin.** We store no cost price. `stockValueAmount` is at retail and
  its field name says so; adding `costAmount` to `ProductVariant` is a catalog
  change and a supplier-invoice question, not an analytics one.

## Deferred

- **`AnalyticsEvent` + a storefront beacon** — page views, product views,
  add-to-cart. The only thing that unlocks conversion, funnels and traffic
  sources, and the reason those are absent above.
- **`Store.timezone`**, so buckets stop depending on a query parameter, with
  `AdvisorSettings.timezone` as an override.
- **A rollup table** with a nightly job, when a live aggregate stops being
  interactive.
- **CSV export** of any panel, and a monthly emailed summary (the Advisor's
  brief is the template).
- **Cost price and margin**, once suppliers' confirmed prices can flow back into
  the catalog — which is what [suppliers-purchasing.md](./suppliers-purchasing.md)
  makes possible for the first time.
- **Search-term analytics** for the storefront search box, which today logs
  nothing; the chatbot's unanswered feed is the only demand signal that exists.
