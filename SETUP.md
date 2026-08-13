# Setup

Getting the InventoAI backend running locally, and what it can serve today.

## Start with the commerce layer, not with auth

Auth and the site builder are finished, and the seed hands you **logged-in
stores**: three of them, with owners, staff, customers, categories,
store-defined attributes and **a full catalog of products** already in place,
plus ready-made access tokens.

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
| `layali` | live | Clothing. 5 categories, one unpublished (`sale`), 3 featured. 5 attributes. 9 products, 26 variants |
| `fokhar` | live | Pottery. 4 categories, 4 attributes, 4 products. Use it to prove store A cannot see store B |
| `draftco` | **draft** | Every storefront route 404s — that is the correct behaviour. No attributes; its one product is unreachable |

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

### The seeded products

Every case the listing, the picker and the search box have to render is in
there, so you never have to create a fixture by hand:

| Store | Product | Why it is there |
| --- | --- | --- |
| layali | `crepe-everyday-abaya` | 6 variants across **two axes** (size × colour), one out of stock, one below its low-stock threshold |
| layali | `silk-occasion-kaftan` | 4 variants with a `compareAtAmount` — the struck-through "was" price |
| layali | `chiffon-hijab` | **One axis only** (colour). A hijab has no size, and the picker must not assume two |
| layali | `linen-summer-abaya` | Three sizes in one colour, one of them sold out |
| layali | `jersey-underscarf-cap` | A **simple product**: one variant, no axes. The dashboard hides the array behind a plain price/stock form |
| layali | `magnetic-hijab-pins-pack-of-12` | Findable only through `searchKeywords` — search `dabbous` or `brooch` |
| layali | `kids-red-cotton-shirt` | An **Arabic title**. Exact and prefix search work; there is no Arabic stemmer, so trigram covers the typos |
| layali | `winter-velvet-abaya` | `draft` — absent from the storefront and **404 on its own slug** |
| layali | `discontinued-satin-abaya` | `archived` — invisible to shoppers, still in the dashboard list |
| fokhar | `fayoum-stoneware-mug` | Glaze × size, so the second store's axes are named nothing like the first's |
| fokhar | `two-mug-gift-set` | In **two categories** at once — a product is not limited to one |

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
| `POST/GET /products`, `GET/PATCH/DELETE /products/:id`, `PATCH /products/reorder` | Product dashboard. `OWNER` or `ADMIN` only. List filters: `search`, `status`, `categoryId`, `isFeatured`, `lowStock`, `sort`, `order` |
| `POST /products/:id/variants`, `PATCH/DELETE /products/:id/variants/:variantId`, `POST /products/:id/variants/generate` | Variants. `generate` is the matrix builder — name the axes and it produces the cross product in one transaction |
| `POST /products/:id/images` (multipart `images`, 1–8), `PATCH /products/:id/images/reorder`, `PATCH/DELETE /products/:id/images/:imageId` | The gallery. `position: 0` is the primary image |
| `POST /catalog/generate`, `POST /catalog/apply` | AI catalog setup — one Gemini call proposes the whole scaffold, a second call writes what the owner kept. `OWNER` or `ADMIN` only |
| `GET /site/:slug` | **Public.** Branding, hero, theme, `featuredCategories` and `featuredProducts` — what the storefront landing page renders from |
| `GET /site/:slug/categories` | **Public.** Published categories, in the owner's order |
| `GET /site/:slug/products` | **Public.** The listing: ranked search, built-in filters, the store's own facets, five sorts |
| `GET /site/:slug/products/suggest` | **Public.** The autocomplete dropdown, capped at 5 |
| `GET /site/:slug/products/:productSlug` | **Public.** The detail page. A `draft` or `archived` product 404s here |
| `GET /site/:slug/filters` | **Public.** What the sidebar renders itself from, with live per-value counts |

Product notes worth knowing before you wire the forms:

- **Every product has at least one variant** — price, SKU and stock live there,
  never on the product. A simple product sends exactly one variant with no
  `attributeValueIds`, and the dashboard hides that array behind a plain
  price/stock form. This is why nothing downstream has to ask "does this product
  have variants?".
- **Axis values go on the variant, descriptive values on the product.** Sending
  a Size in the product's `attributeValueIds` is a `400` naming the attribute,
  and so is a Fabric inside a variant. It is the single likeliest mistake here.
- **`minPriceAmount`, `maxPriceAmount`, `totalStock` and `variantCount` are
  derived** — the server recomputes them on every variant write. Read them,
  never send them. `min == max` means one price; otherwise render "from …".
- **Deleting the last variant is a `400`.** Archive the product instead
  (`status: "archived"`): invisible to shoppers, still in the dashboard and in
  reports.
- **Stock is never published exactly.** The storefront gets `stockLeft: 3` at or
  below 5, and `null` above it — the exact number is the store's sales rate.

### The AI catalog setup — two calls, and the first one writes nothing

`POST /catalog/generate` returns a **proposal**: the categories and the
attributes (with their values, in order, and the style each renders as) that
suit the business the owner already described. Nothing is saved. The owner edits
it in your UI — rename, drop, reorder — and you send back what survived:

```bash
curl -X POST localhost:3000/catalog/generate -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"instructions":"more categories for kids, we do not sell shoes"}'

curl -X POST localhost:3000/catalog/apply -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"categories":[{"name":"Abayas","description":"Everyday and occasion abayas"}],
       "attributes":[{"name":"Size","isVariantAxis":true,"displayStyle":"chip",
                      "values":[{"value":"S"},{"value":"M"},{"value":"L"}]}]}'
# -> {"categoriesCreated":1,"categoriesSkipped":0,
#     "attributesCreated":1,"attributesSkipped":0,"skipped":[]}
```

What the screen has to honour:

- **`instructions` is the only thing you send to `generate`.** Everything about
  the business comes from the questionnaire the backend already stores — do not
  re-send it, and an owner cannot point the generation at a different business.
- **Array order is the order the shopper will see.** Sizes come back
  `S, M, L, XL, 2XL`; keep that order through your editor and back, because the
  server assigns `position` by index and never sorts.
- **`displayStyle` is decided per attribute, not guessed by you.** `swatch`
  arrives with a `#RRGGBB` on every value, `chip` and `list` with none. Sending
  a `swatchHex` under a non-swatch style is a `400`, and so is a `swatch` value
  without one.
- **Applying twice is safe.** An entry the store already has is skipped, never
  renamed — you will get `skipped: ["abayas","size"]`, not `abayas-2`. Both
  arrays are optional, so an owner who wants only the attributes sends only the
  attributes.
- **An apply is all-or-nothing.** One invalid attribute `400`s and writes no
  categories either.
- **`generate` is rate-limited per store** — a second call inside 30 seconds is
  a `429` whose message names the seconds left. Disable the button while the
  first call is in flight; it takes a few seconds and costs real money.
- **`503`** means Gemini is unavailable. The cooldown is released in that case,
  so "try again" is a real option.

### Searching, filtering and the facet grammar

`?size=xl` **cannot work** and returns `400 property size should not exist`:
`forbidNonWhitelisted` is on, and no DTO can declare a field that is a row in
someone's database. Custom facets travel as one parameter instead:

```
?attributes=size:xl,l;color:red
              │   │  │   └── another facet, ';' separated
              │   │  └────── another value, ',' separated  (OR within a facet)
              │   └───────── value slugs
              └───────────── the attribute's key
```

**OR within a facet, AND across facets** — and AND is evaluated per *product*,
not per variant: a mug sold in XL/ivory and S/black matches `size:xl;color:black`,
because the shopper is asking which products come in those, not which single
variant does. An unknown key or value is **ignored, not rejected**, so a
bookmarked link survives the owner deleting a value.

Search returns two extra fields on the listing envelope:

| Field | Meaning |
| --- | --- |
| `searchMode: "exact"` | Ranked full-text found results — title matches outrank description matches |
| `searchMode: "fuzzy"` | Full-text found nothing, so a trigram pass ran. `didYouMean` carries the closest title: *Showing results for "popcorn machine"* |
| `searchMode: null` | No search term was sent |

What the frontend has to do:

- **Debounce at ~300 ms.** It cuts a typed word from ~8 requests to 1.
- **Do not fire under 2 characters.** The backend treats a 1-character search as
  no search at all, so you would just be re-fetching the full page.
- **Send `sort` only when the shopper picks one.** Omitted, it is `relevance`
  when a search is present and `newest` otherwise. `sort=relevance` with no
  search quietly falls back to `newest` rather than erroring — a shared search
  URL must not become an error page when the box is cleared.

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

```bash
# a simple product — one variant, no axes
curl -X POST localhost:3000/products \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Blue Mug","status":"active",
       "variants":[{"priceAmount":24900,"stockQuantity":40}]}'

# the matrix builder — 3 sizes x 2 colours becomes 6 variants in one transaction
curl -X POST localhost:3000/products/<id>/variants/generate \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"axes":[{"attributeId":"<size>","valueIds":["<s>","<m>","<l>"]},
               {"attributeId":"<color>","valueIds":["<black>","<ivory>"]}],
       "priceAmount":24900,"stockQuantity":0}'

# storefront — public, no token
curl "localhost:3000/site/layali/products?search=abaya"
curl "localhost:3000/site/layali/products?search=abya"        # fuzzy + didYouMean
curl "localhost:3000/site/layali/products?attributes=color:black,navy;size:m"
curl "localhost:3000/site/layali/products/suggest?search=chif"
curl localhost:3000/site/layali/filters
```

Re-running `generate` adds only the combinations that do not exist yet, so it is
safe to call after the owner adds a colour.

### Already done — you can skip building screens for these

| Routes | What they do |
| --- | --- |
| `POST /users/register[/owner]`, `/login[/owner]`, `/verify-email[/owner]`, `/resend-verification[/owner]`, `/forgot-password[/owner]`, `/reset-password[/owner]`, `/refresh-token`, `PATCH /users/change-password` | Full auth. `/owner` variants are platform accounts; the plain ones take a `storeSlug`. The seed's tokens mean you need none of this to start |
| `GET /site-builder/questions`, `POST /brainstorm`, `/answers`, `/domain`, `/themes`, `GET /themes`, `POST /publish` | The onboarding flow. `/themes` calls Gemini |
| `PATCH /stores/me/hero` | Edit the landing page hero (multipart, `image`) |

### Not built yet

FAQ, orders, payments.

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
