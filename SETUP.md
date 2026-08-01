# Setup

Getting the InventoAI backend running locally, and what it can serve today.

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
known set of stores, accounts and categories, and prints working credentials and
access tokens.

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
| `layali` | live | Clothing. 5 categories, one unpublished (`sale`), 3 featured |
| `fokhar` | live | Pottery. 4 categories. Use it to prove store A cannot see store B |
| `draftco` | **draft** | Every storefront route 404s — that is the correct behaviour |

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
the commerce layer is in progress.

### Available now

| Routes | What they do |
| --- | --- |
| `POST /users/register[/owner]`, `/login[/owner]`, `/verify-email[/owner]`, `/resend-verification[/owner]`, `/forgot-password[/owner]`, `/reset-password[/owner]`, `/refresh-token`, `PATCH /users/change-password` | Full auth. `/owner` variants are platform accounts; the plain ones take a `storeSlug` |
| `GET /site-builder/questions`, `POST /brainstorm`, `/answers`, `/domain`, `/themes`, `GET /themes`, `POST /publish` | The onboarding flow. `/themes` calls Gemini |
| `PATCH /stores/me/hero` | Edit the landing page hero (multipart, `image`) |
| `GET /site/:slug` | **Public.** Branding, hero, theme and `featuredCategories` — what the storefront landing page renders from |
| `GET /site/:slug/categories` | **Public.** Published categories, in the owner's order |
| `POST/GET /categories`, `GET/PATCH/DELETE /categories/:id`, `PATCH /categories/reorder`, `PUT/DELETE /categories/:id/image` | Category dashboard. `OWNER` or `ADMIN` only |

### Not built yet

Products, variants, product attributes and filters, FAQ, orders, payments.

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
