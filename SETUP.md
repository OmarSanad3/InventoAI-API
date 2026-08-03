# Setup

Getting the InventoAI backend running locally, and what it can serve today.

## Start with the commerce layer, not with auth

Auth and the site builder are finished, and the seed hands you **logged-in
stores**: three of them, with owners, staff, customers, categories and
store-defined attributes already in place, plus ready-made access tokens.

So you do **not** need a login screen or an onboarding wizard to start. Paste a
token into your HTTP client (or your app's dev config) and build the dashboard
and storefront against a store that already exists. The login, registration,
OTP and site-builder screens can come later — the endpoints behind them will not
change while you build the catalog.

## 1. Prerequisites

- **Node 20+** and npm
- **Docker** with Compose

## 2. The `.env` file

**Ask Omar for it.** It is not in the repository — it holds real Cloudinary,
Gemini and SMTP credentials, so it is gitignored on purpose.

Put it at the repository root, next to `package.json`. `.env.example` shows the
shape but its values are blank, and the app **refuses to boot** on a missing or
mistyped variable, so the example alone is not enough to start.

One detail worth knowing: `docker-compose.yml` reads `POSTGRES_USER` /
`POSTGRES_PASSWORD` / `POSTGRES_DB` while the app reads `DATABASE_USER` /
`DATABASE_PASSWORD` / `DATABASE_NAME`. Both sets live in the same file and
**must agree**.

## 3. Install and start

```bash
npm ci
docker compose up -d        # postgres:5432, redis:6379, adminer:8080
npm run seed -- --force     # wipes the database and fills it with test data
npm run start:dev           # http://localhost:3000
```

If Postgres or Redis is already running on your machine, the containers cannot
bind their ports. Stop the local services first:

```bash
sudo systemctl stop redis
sudo systemctl stop postgresql
```

There are no migrations yet — `synchronize: true` builds the schema on boot in
development, so a schema change just needs a restart.

## 4. The seed script

`npm run seed -- --force` **deletes every row in the database**, then recreates a
known set of stores, accounts, categories and product attributes, and prints
working credentials, access tokens and **the row ids to paste into an API
client** — so a `GET /categories/:id` or `PATCH /product-attributes/:id` can be
called without listing first.

It refuses to run unless `NODE_ENV=development`, and the `--force` is required —
both because it is destructive. It clears only the `refresh:*` and `otp:*` keys
in Redis, never `FLUSHDB`, in case the instance is shared with something else on
your machine.

Re-run it whenever you want a clean slate, or just fresh tokens.

### What it creates

Password for every account: **`Password123!`**

| Email | Role | Store | Use it for |
| --- | --- | --- | --- |
| `owner.layali@inventoai.test` | OWNER | layali | The dashboard |
| `admin.layali@inventoai.test` | ADMIN | layali | The dashboard, as staff |
| `shopper.layali@inventoai.test` | USER | layali | Storefront customer |
| `unverified.layali@inventoai.test` | USER | layali | Login returns **403** |
| `owner.fokhar@inventoai.test` | OWNER | fokhar | A second store, for isolation tests |
| `shopper.fokhar@inventoai.test` | USER | fokhar | Storefront customer |
| `owner.draft@inventoai.test` | OWNER | draftco | Owns an unpublished store |

Three stores, chosen so the awkward cases are reachable without editing the
database by hand:

| Slug | Status | Notes |
| --- | --- | --- |
| `layali` | live | Clothing. 5 categories, one unpublished (`sale`), 3 featured. 5 attributes |
| `fokhar` | live | Pottery. 4 categories, 4 attributes. Use it to prove store A cannot see store B |
| `draftco` | **draft** | Every storefront route 404s — that is the correct behaviour. No attributes |

### The seeded attributes

Attributes are the store's **own** filters — the platform does not know what a
store sells, so each one declares its facets. The two live stores are seeded
with deliberately different shapes, because a client that only ever sees one
store's will hardcode it:

| Store | Attribute | Style | Kind | Values |
| --- | --- | --- | --- | --- |
| layali | `size` | `chip` | variant axis | S, M, L, XL, XXL |
| layali | `color` | `swatch` | variant axis | Black, Ivory, Sand, Olive, Burgundy, Navy — each with a hex |
| layali | `fabric` | `list` | descriptive | Crepe, Chiffon, Jersey, Linen, Silk |
| layali | `occasion` | `dropdown` | descriptive | Everyday, Work, Eid, Wedding |
| layali | `sleeve-length` | `list` | descriptive, **`isFilterable: false`** | Full, Three-quarter, Cap |
| fokhar | `glaze` | `swatch` | variant axis | Terracotta, Sand, Charcoal, Sea Green |
| fokhar | `size` | `chip` | variant axis | S, M, L |
| fokhar | `collection` | `list` | descriptive | Fayoum, Nile, Oasis |
| fokhar | `care` | `list` | descriptive | Dishwasher safe, Hand wash |

Between them they cover every case the sidebar has to render:

- **`swatch`** — a filled circle per value, in `swatchHex`, the name as its
  tooltip and accessible label. Only this style carries a colour.
- **`chip`** — a uniform neutral circle with the value's *text* inside (`S`,
  `XL`). Never a colour, which is why it is a separate style from `swatch`:
  never guess from the attribute's name, it breaks on "Colour"/"Couleur"/"اللون".
- **`list`** — a checkbox and label per value.
- **`dropdown`** — a single `<select>`, for long lists.
- **`isFilterable: false`** (`sleeve-length`) — belongs on the product page's
  spec table but **not** in the sidebar.
- **`isVariantAxis`** — `true` means the shopper picks one before adding to cart
  and it changes SKU, price and stock; `false` means it only describes and
  filters. `draftco` has none at all, which is the "built-in filters only" case.

### Logging in

Owners log in at `/users/login/owner`. **Admins and customers log in at
`/users/login` with a `storeSlug`** — an admin posting to `/login/owner` gets a
401, which is intentional.

```bash
curl -X POST localhost:3000/users/login/owner \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner.layali@inventoai.test","password":"Password123!"}'

curl -X POST localhost:3000/users/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin.layali@inventoai.test","password":"Password123!","storeSlug":"layali"}'
```

The seed also prints ready-made access tokens so you can skip login entirely
while building. If a token expires mid-session, re-run the seed or raise
`JWT_ACCESS_EXPIRES_IN` in your own `.env` — it takes values like `12h`.

## 5. What the API can serve today

The backend is being built in branches. **Auth and the site builder are done**;
the commerce layer is in progress. The commerce routes come first here because
they are the ones you have left to build against.

### The commerce layer — build this first

| Routes | What they do |
| --- | --- |
| `POST/GET /categories`, `GET/PATCH/DELETE /categories/:id`, `PATCH /categories/reorder`, `PUT/DELETE /categories/:id/image` | Category dashboard. `OWNER` or `ADMIN` only |
| `POST/GET /product-attributes`, `GET/PATCH/DELETE /product-attributes/:id`, `PATCH /product-attributes/reorder` | Attribute dashboard — the store's own filters. `OWNER` or `ADMIN` only |
| `POST /product-attributes/:id/values`, `PATCH/DELETE /product-attributes/:id/values/:valueId`, `PATCH /product-attributes/:id/values/reorder` | The controlled value list. **Every one of these returns the whole attribute**, values included, so no re-fetch after an edit |
| `GET /site/:slug` | **Public.** Branding, hero, theme and `featuredCategories` — what the storefront landing page renders from |
| `GET /site/:slug/categories` | **Public.** Published categories, in the owner's order |

Attribute notes worth knowing before you wire the forms:

- **Creation takes its values inline.** `POST /product-attributes` accepts
  `values: [{ value, slug?, swatchHex? }]`, so "Size with S/M/L" is one request,
  not four. Max 20 attributes per store, 100 values per attribute.
- **`key` and `slug` are addresses, `name` and `value` are copy.** Renaming
  "Size" to "Sizing" leaves `key: "size"` alone — bookmarked filter URLs keep
  working. Send an explicit `key`/`slug` to move one; duplicates get a numeric
  suffix (`size-2`) rather than an error.
- **`isVariantAxis` cannot be changed after creation.** It is not in the update
  DTO at all, so sending it is a `400`. Changing it means delete and recreate.
- **`swatchHex` is required on every value of a `swatch` attribute and rejected
  on every other style.** Switching an attribute away from `swatch` clears its
  colours; switching back then needs them again, so treat it as one-way in the
  UI.

```bash
TOKEN=<owner.layali access token printed by the seed>

# the whole attribute, values and all, in one request
curl -X POST localhost:3000/product-attributes \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
        "name": "Colour",
        "key": "color",
        "isVariantAxis": true,
        "displayStyle": "swatch",
        "values": [
          { "value": "Red",  "swatchHex": "#e11d48" },
          { "value": "Blue", "swatchHex": "#2563eb" }
        ]
      }'

# reorder — the whole list at once, applied in one transaction
curl -X PATCH localhost:3000/product-attributes/reorder \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"items":[{"id":"<id>","position":0},{"id":"<id>","position":1}]}'
```

A rejected reorder writes **nothing** — if any id is foreign, duplicated or
missing, the whole request 400s and every position stays as it was.

### Already done — you can skip building screens for these

| Routes | What they do |
| --- | --- |
| `POST /users/register[/owner]`, `/login[/owner]`, `/verify-email[/owner]`, `/resend-verification[/owner]`, `/forgot-password[/owner]`, `/reset-password[/owner]`, `/refresh-token`, `PATCH /users/change-password` | Full auth. `/owner` variants are platform accounts; the plain ones take a `storeSlug`. The seed's tokens mean you need none of this to start |
| `GET /site-builder/questions`, `POST /brainstorm`, `/answers`, `/domain`, `/themes`, `GET /themes`, `POST /publish` | The onboarding flow. `/themes` calls Gemini |
| `PATCH /stores/me/hero` | Edit the landing page hero (multipart, `image`) |

### Not built yet

Products, variants and their images, the storefront `/filters` payload with
per-value counts, FAQ, orders, payments.

The response shapes are already specified in detail, so you can build against
them with mocks and swap in the real API when each branch lands:

- [context/features/products.md](context/features/products.md) — product listing,
  detail, and the `/site/:slug/filters` payload
- [context/features/product-attributes.md](context/features/product-attributes.md)
  — the attribute/facet model and the **rendering contract** (which filters draw
  as colour circles, which as lettered chips)
- [context/features/ecommerce-core.md](context/features/ecommerce-core.md) — the
  decisions all of them share
- [context/features/orders.md](context/features/orders.md),
  [payments.md](context/features/payments.md),
  [faq.md](context/features/faq.md)

## 6. Conventions worth knowing before you call anything

- **Money is integer minor units.** `priceAmount: 24900` means `249.00 EGP`. The
  currency is on the store. The API never returns a formatted string.
- **Unknown fields are rejected.** The global validation pipe runs
  `forbidNonWhitelisted`, so sending a property no DTO declares is a `400`, not
  a silent ignore. In particular you never send `storeId` — the server derives
  it from your token or the URL slug.
- **Another store's row 404s, it does not 403.** A 403 would confirm the id
  exists.
- **Auth header** is `Authorization: Bearer <accessToken>`.
- **Refresh tokens are single-use.** `POST /users/refresh-token` returns a new
  pair and invalidates the old refresh token; reusing one fails.
- **CORS** allows `http://localhost:4200` by default. Change `CORS_ORIGINS` in
  `.env` if your dev server uses another port.

## 7. Handy extras

- **Adminer** at http://localhost:8080 — browse the database. Server `db`,
  and the user/password/database from your `.env`.
- `npm run lint`, `npm test`, `npm run build`.
- `docker compose down -v` removes the containers **and** their volumes, which
  drops the database entirely. `npm run seed -- --force` rebuilds it.
