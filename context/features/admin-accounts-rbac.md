# Admin accounts and per-admin permissions

> The open item in [TODO.md](../../TODO.md): *"`ADMIN` exists as a role, but
> nothing creates one yet."* Feature 5 of the
> [project overview](../project-overview.md) — "Owner can create admin accounts
> (email + password) for their store, as many as they need, so staff can help
> run the e-commerce with them."
>
> No AI, no storefront surface, no new dependency. One new enum, three new
> columns, one new guard.

## Overview

`UserRole.ADMIN` has been in the codebase since the auth branch and every
dashboard route already accepts it — `@Roles(OWNER, ADMIN)` is on `/products`,
`/orders`, `/faqs`, `/chat/*`, `/advisor/*` and `/suppliers`. Two things are
missing, and the second is the interesting one:

1. **Nothing creates an admin.** There is no route; the seed writes the row
   directly.
2. **An admin can do everything an owner can.** That is fine for a two-person
   shop and wrong for the case the overview describes — "staff can help run the
   e-commerce". The person who answers the chat should not be able to rewrite
   the store's theme, and the warehouse should not read the analytics.

So this feature is: the owner creates staff accounts, **chooses what each one
can do**, changes their mind later, switches them off, and removes them — and
the new account is forced to change the password the owner typed for it before
it can do anything at all.

## Goals

- An owner creates an admin with an email and an initial password.
- That admin **must change the password** before any other route will answer.
- The owner grants a set of permissions per admin, from a catalogue the API
  publishes (the dashboard does not hardcode it).
- The owner can revoke or change permissions, and **revocation takes effect on
  the next request** — not when a token happens to expire.
- The owner can deactivate an account (reversible, sessions die) or delete it.
- An admin can never create, edit or promote another admin.

## Non-goals

- **Named roles** ("Warehouse", "Support") as reusable, editable objects. A
  fixed list of presets is offered as a convenience; a `permission_sets` table
  is [deferred](#deferred).
- **Per-record scoping** ("this admin may only touch orders they were assigned").
  Permissions are per module, not per row.
- **An audit log.** Who changed which order is a separate feature and a separate
  table; this one does not pretend to answer it.
- **Invitation links / self-set passwords.** The owner types the initial
  password, as the overview says. See decision 3 for what is *not* done with it.
- **2FA, IP allowlists, session lists.** Later, if ever.
- **Touching `USER` or `OWNER` behaviour.** A shopper's login is unchanged; an
  owner has every permission by construction and cannot be granted or denied
  one.

## Decisions

### 1. Permissions live in the database, never in the JWT

The tempting design is to stamp the permission list into the access token: no
lookup, guard reads `request.user.permissions`, done. It is wrong for the one
requirement that matters here — **"owner can revoke permissions from admins"**.

```
   permissions in the JWT                permissions in the row
  ────────────────────────              ────────────────────────
  revoke at 10:00                       revoke at 10:00
  admin's token minted 09:58            next request → 403
  → still fully authorised until        (the row is the truth, and the
    it expires, up to JWT_ACCESS_        cache key is deleted on write)
    EXPIRES_IN later
```

A revocation that is *eventually* true is a revocation that has to be explained
to whoever revoked it. So the JWT keeps carrying `sub`, `role` and `storeId` —
unchanged — and `PermissionsGuard` reads the grant from the row.

**The cost is one lookup per guarded request**, and it is paid down the way the
rest of this project pays such things: a Redis cache at `admin:perms:<userId>`
with `PERMISSION_CACHE_SECONDS` (60), **deleted by every write** that touches
permissions, `isActive` or the row's existence. The cache is there for load, not
for correctness — correctness is the invalidation.

### 2. Only an owner administers admins, and there is no permission that says otherwise

There is deliberately **no `admins:read` / `admins:write` in the catalogue**. The
`/admins` routes are `@Roles(OWNER)`, full stop.

That closes the escalation loop before it exists: if administering admins were
a grantable permission, an admin holding it could grant themselves everything
else, and "the owner decides what staff can do" would be decoration. The owner
is the grantor, not a role with a bigger list.

`PermissionsGuard` therefore **passes an `OWNER` through unconditionally** — an
owner's authority comes from `Store.ownerId`, and giving them a permission list
would be a second source of truth that can disagree with the first.

### 3. The initial password is typed by the owner, mailed to nobody, and must be changed

The overview says "email + password", so the owner sets one. Two rules follow:

- **The password is never in an email.** The notification tells the new admin an
  account exists and where to sign in; the owner passes the password on however
  they like — in person, on the phone, in whatever chat they already use.
  Mailing a plaintext credential to an inbox we do not control is the kind of
  thing that reads fine in a spec and badly in a breach report.
- **`mustChangePassword` is true until they change it.** The admin can log in —
  the token pair is issued normally — but every route except the ones needed to
  fix it answers **403 `PASSWORD_CHANGE_REQUIRED`**. The owner knows that
  password; until it is changed, the account is shared credentials with extra
  steps.

Allowed while the flag is set: `PATCH /users/change-password`,
`POST /users/refresh-token`, and `GET /users/me`. Everything else 403s,
including the whole dashboard.

The account is created **`isEmailVerified: true`** with no OTP — the owner
vouched for the address, and an OTP the owner would have to forward is theatre.
Consequence, stated because it is a real one: a typo'd email produces an account
whose password-reset mail goes to a stranger. The owner can delete it and the
address is immediately reusable.

### 4. Creation succeeds even if the notification mail fails

`createUser` deletes the row and 503s when the OTP mail fails, because there a
user *cannot* verify without it. Here the mail carries nothing the account needs
— the owner already knows the password — so a dead SMTP must not cost the owner
their staff account. The response carries `notified: boolean` and the dashboard
can say "created, but we could not email them".

### 5. Deactivate is the reversible one; delete is real

| Action | Row | Sessions | Reversible |
| --- | --- | --- | --- |
| `PATCH /admins/:id` `{ isActive: false }` | stays | **killed** | yes — flip it back |
| `DELETE /admins/:id` | **gone** | killed | no |

`isActive` is a new column on `User` and is checked in **`login`** (403, worded
like the unverified-email case) and in `PermissionsGuard`, so a live session
dies too.

The delete is a hard delete, not a soft one, and that is a deliberate departure
from `Category`/`Product`/`Supplier`: nothing in the schema points at an admin
except `Order.userId`, which is already `ON DELETE SET NULL` and whose contact
details are snapshotted on the order anyway. Adding `deletedAt` to `User` would
also mean reworking both partial unique email indexes. **Deactivate is what the
dashboard should offer first**; delete is for the address you want freed.

### 6. Killing a session, given stateless access tokens

Two halves, because there are two kinds of token:

```
  refresh tokens →  RedisService.deleteByPattern(`refresh:${userId}:*`)
                    (they are already stored one key per jti — this is why)

  access tokens  →  cannot be un-signed. PermissionsGuard loads the row
                    (or its 60s cache, invalidated on the same write) and
                    401s an account that is inactive or gone.
```

So an admin's access token stops working within the same request, and the
project keeps its stateless `JwtAuthGuard` for everybody else — an `OWNER` or a
shopper still costs zero lookups.

### 7. Permissions are module-shaped, and split read from write

Fine-grained per-endpoint scopes (`products:create`, `products:reorder`,
`products:images:delete`) are unmaintainable — every new route is a new scope
and a migration for everyone who should have had it. The dashboard is organised
by module, so the permissions are too:

```ts
export enum AdminPermission {
  CatalogRead = 'catalog:read',       // products, categories, attributes, search
  CatalogWrite = 'catalog:write',     // + images, AI catalog setup
  OrdersRead = 'orders:read',
  OrdersWrite = 'orders:write',       // status machine, internal notes
  FaqRead = 'faq:read',
  FaqWrite = 'faq:write',
  ChatRead = 'chat:read',             // transcripts, unanswered feed, stats
  ChatWrite = 'chat:write',           // settings, marking reviewed
  AdvisorRead = 'advisor:read',
  AdvisorWrite = 'advisor:write',     // settings, dismissing insights
  SuppliersRead = 'suppliers:read',
  SuppliersWrite = 'suppliers:write', // send a request, confirm a deal
  AnalyticsRead = 'analytics:read',   // dashboard-analytics.md
  StorefrontWrite = 'storefront:write', // theme, hero, logo, regeneration
}
```

Two things worth noticing:

- **`suppliers:write` spends money** and `storefront:write` changes what every
  visitor sees. They are the two an owner should think hardest about, and the
  catalogue endpoint marks them `isSensitive: true` so the dashboard can style
  them differently.
- **A write implies its read.** `PermissionsGuard` treats `catalog:write` as
  satisfying `catalog:read`, so the owner cannot produce the nonsense state of
  an admin who may edit a product but not open the page it is on.

## Auth & access control

| Surface | Rule |
| --- | --- |
| `/admins/**` | `JwtAuthGuard` + `RolesGuard`, `@Roles(OWNER)` — **owner only** |
| Every existing dashboard route | unchanged `@Roles(OWNER, ADMIN)`, **plus** `@RequirePermissions(…)` |
| `PermissionsGuard` | `OWNER` passes; `ADMIN` is checked against the row; anything else 403 |

Guard order is `JwtAuthGuard → RolesGuard → PermissionsGuard`, so an
unauthenticated call is still 401 and a shopper is still 403 before any lookup
happens.

## Data model

### `User` (existing) — three new columns

| Column | Type | Notes |
| --- | --- | --- |
| `permissions` | `enum[]` of `AdminPermission`, default `'{}'` | Only meaningful for `ADMIN`. An `OWNER` bypasses the guard; a `USER` has no guarded routes |
| `mustChangePassword` | `boolean`, default `false` | Set on create and on an owner-driven password reset |
| `isActive` | `boolean`, default `true` | Applies to every role; checked in `login` and in `PermissionsGuard` |

```ts
@Column({
  type: 'enum',
  enum: AdminPermission,
  array: true,
  default: '{}',
})
permissions!: AdminPermission[];
```

**No join table.** Permissions are always read as a whole set for one user and
never queried across users; an array column is one row read instead of a join,
and Postgres can still answer `WHERE permissions @> '{orders:write}'` if a
report ever wants it.

`User.password` is already `select: false` and stays that way. If
[google-oauth.md](./google-oauth.md) lands first, `password` is nullable and an
admin created here simply has one — the two features do not collide.

## Endpoints — `src/users/admins.controller.ts`

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| `GET` | `/admins/permissions` | — | `PermissionCatalogueDto` |
| `POST` | `/admins` | `CreateAdminDto` | `AdminResponseDto` (201) |
| `GET` | `/admins` | — | `AdminResponseDto[]` |
| `GET` | `/admins/:id` | — | `AdminResponseDto` |
| `PATCH` | `/admins/:id` | `UpdateAdminDto` | `AdminResponseDto` |
| `POST` | `/admins/:id/reset-password` | `ResetAdminPasswordDto` | `MessageResponseDto` |
| `DELETE` | `/admins/:id` | — | `MessageResponseDto` |

`GET /admins/permissions` is declared **before** `GET /admins/:id`, the same
rule `PATCH /faqs/reorder` follows.

Notes on three of them:

- **`GET /admins/permissions`** returns the catalogue *and* the presets, so no
  dashboard hardcodes a permission string:
  ```jsonc
  {
    "permissions": [
      { "key": "orders:write", "group": "orders", "implies": ["orders:read"],
        "isSensitive": false, "label": "Manage orders" }, …
    ],
    "presets": [
      { "key": "order_desk", "label": "Order desk",
        "permissions": ["orders:read", "orders:write", "chat:read"] }, …
    ]
  }
  ```
- **`PATCH /admins/:id`** carries `firstName`, `lastName`, `permissions` and
  `isActive`. `permissions` **replaces** the set — a PATCH that sends three
  permissions leaves exactly three. Partial add/remove semantics on a set are
  how two dashboard tabs silently undo each other.
- **`POST /admins/:id/reset-password`** is the owner's "they forgot it" button:
  sets a new password, sets `mustChangePassword: true`, kills every session.
  It does **not** go through the OTP flow — the admin's own
  `POST /users/forgot-password` still does, and still mails them.

Not paginated: `MAX_ADMINS_PER_STORE` (10) keeps the list one screen, the same
call `MAX_FAQS_PER_STORE` makes.

## DTOs — `src/users/dto/`

| File | Shape |
| --- | --- |
| `create-admin.dto.ts` | `firstName`, `lastName`, `email` (`@IsEmail()`), `password` (the existing `PASSWORD_PATTERN` + `@MinLength(8)`), `permissions` (`@IsEnum(AdminPermission, { each: true })`, `@ArrayUnique()`, may be empty) |
| `update-admin.dto.ts` | all of `firstName?`, `lastName?`, `permissions?`, `isActive?` |
| `reset-admin-password.dto.ts` | `password`, same rules as create |
| `admin-response.dto.ts` | `id`, `firstName`, `lastName`, `email`, `permissions`, `isActive`, `mustChangePassword`, `lastLoginAt?`, timestamps — **never** the password hash |
| `permission-catalogue.dto.ts` | the catalogue + presets above |

No `storeId` and no `role` on any of them: the store comes from the owner's
resolved store and the role is always `ADMIN`. `forbidNonWhitelisted` turns
either into a 400.

`UserResponseDto` gains `permissions` and `mustChangePassword`, so the admin's
own login response tells their dashboard what to render and whether to force the
password screen. That is the only change to an existing response shape.

## Guard and decorator — `src/common/`

```ts
// decorators/require-permissions.decorator.ts
export const RequirePermissions = (...permissions: AdminPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

// guards/permissions.guard.ts
//  OWNER                      → allow
//  not ADMIN                  → 403
//  row missing / !isActive    → 401 (the session is over, not merely refused)
//  mustChangePassword         → 403 PASSWORD_CHANGE_REQUIRED
//  every required permission  → allow, else 403 naming what is missing
```

The 403 body names the missing permission (`"orders:write"`), because "you do not
have permission to perform this action" is a message that produces a support
ticket rather than an understanding.

**A route with no `@RequirePermissions` is unrestricted for any admin**, which
is exactly today's behaviour — so the rollout is additive and nothing breaks
while the decorators are being added module by module.

## Mail — `src/mail/`

One addition: `sendAdminInvitation({ to, brand, storeName, dashboardUrl })`,
following `sendAdvisorBrief`. Branded as the **store**, not the platform. It
says an account was created, who created it, where to sign in, and that the
password must be changed on first use. **It contains no password.**

## Constants — `src/users/users.constants.ts`

```ts
export const MAX_ADMINS_PER_STORE = 10;
export const PERMISSION_CACHE_SECONDS = 60;
export const PERMISSION_CACHE_PREFIX = 'admin:perms:';
/** `catalog:write` satisfies `catalog:read`, and so on. */
export const PERMISSION_IMPLICATIONS: Readonly<
  Partial<Record<AdminPermission, readonly AdminPermission[]>>
>;
export const PERMISSION_PRESETS: readonly PermissionPreset[];
```

## Implementation order

1. `AdminPermission` enum, `PERMISSION_IMPLICATIONS`, `PERMISSION_PRESETS`, and
   the pure `hasPermission({ granted, required })` helper **with its tests** —
   the implication rule is the part worth trusting.
2. The three `User` columns.
3. `login` refuses an inactive account (403); `changePassword` clears
   `mustChangePassword` and revokes every refresh token.
4. `@RequirePermissions` + `PermissionsGuard` + the Redis cache and its
   invalidation. **Applied to nothing yet** — it is a no-op until step 6.
5. `AdminService` + `AdminsController`: create, list, get, update, reset, delete,
   catalogue. Each write invalidates the cache and, where it should, kills
   sessions.
6. Decorate the existing dashboard controllers, one module per commit, starting
   with `orders` and `catalog`.
7. Seed: `layali` gets a second admin with a narrow grant.

Step 4 before 5, and 5 before 6, so at no point does a half-applied guard lock
an owner out of their own store.

## Seed

`SEED_STORES` gains a `staff` list. `layali` gets its existing full-access
`admin.layali@inventoai.test` (**explicitly granted every permission**, because
the default is now an empty set) plus `desk.layali@inventoai.test` — orders and
chat only, `mustChangePassword: true`, so the forced-change screen is reachable
without creating an account first. `fokhar` gets one full-access admin,
`draftco` none.

`npm run seed -- --force` prints an **admins** block per store: the email, the
granted permissions, and whether the password must be changed.

## Tests

Unit (`src/users/utils/`):

- `hasPermission` — an exact grant passes; `catalog:write` satisfies
  `catalog:read`; `catalog:read` does **not** satisfy `catalog:write`; an empty
  grant fails everything; a route requiring two permissions needs both.
- `resolvePresetPermissions` — a preset expands to its set and de-duplicates.

Endpoint:

- Owner creates an admin → 201, `mustChangePassword: true`, the password hash is
  absent from the response, and the admin can log in.
- That admin calls **any** dashboard route → 403 `PASSWORD_CHANGE_REQUIRED`;
  changes the password → the same route now answers, and the old password no
  longer logs in.
- An admin with `orders:read` only: `GET /orders` 200,
  `PATCH /orders/:id/status` **403 naming `orders:write`**, `GET /products` 403.
- Granting `catalog:write` alone lets them read the catalog too (implication).
- **Revocation is immediate**: with a live access token, the owner removes
  `orders:write`; the admin's very next call is 403 without re-logging in.
- Deactivating: the admin's next call is 401, their refresh token is gone, and
  logging in again is 403. Reactivating restores login.
- Deleting: the row is gone, the email is immediately reusable, and any order
  they had placed still renders (its `userId` is null, its snapshot intact).
- An admin calling `/admins` at all → 403 (no permission exists that grants it).
- An admin cannot create an admin, cannot PATCH their own permissions, and
  cannot deactivate the owner.
- Store B's owner sees none of store A's admins; every `/admins/:id` verb 404s
  across stores.
- The 11th admin → 400. A duplicate email in the same store → 400; the same
  email as a *shopper of another store* → allowed (the index is per store).
- `role`, `storeId` or `mustChangePassword: false` in a create body → 400
  `should not exist`.
- An `OWNER` is never blocked by `PermissionsGuard`, on any decorated route.

## Considered and rejected

- **Permissions in the JWT.** Decision 1 — revocation would lag by up to the
  access-token lifetime, and the requirement is explicitly "the owner can revoke
  permissions".
- **A `permission_sets` / named-roles table now.** The presets cover the same
  ground for a 10-person shop at a fraction of the surface. It becomes right
  when an owner wants to edit a role and have it apply to five people at once —
  [deferred](#deferred), and the array column migrates into it cleanly.
- **Per-endpoint scopes.** Every new route becomes a new scope nobody has, and
  an owner is asked questions about routes rather than about jobs.
- **Making the owner a permission holder** with a full set. A second source of a
  truth `Store.ownerId` already tells, and one bad UPDATE away from an owner
  locked out of their own store.
- **A soft-deleted admin.** Both unique email indexes would need reworking, and
  nothing in the schema needs the row to survive — `Order.userId` is already
  `SET NULL` and the order snapshots its contact details.
- **Mailing the initial password.** A plaintext credential in a mailbox we do
  not control, for no benefit: the owner typed it and can pass it on.
- **An invitation link with a self-set password.** Better security, and a
  different feature — it needs a signed invite token, an expiry, and a public
  route. Recorded in [deferred](#deferred); the overview asked for email +
  password.

## Deferred

- **Named, editable roles** (`permission_sets`), and assigning a role to several
  admins at once.
- **An audit log** — who changed what, when. The table this feature makes
  worth having.
- **Invitation links** instead of an owner-typed password.
- **`lastLoginAt`** and a session list the owner can end individually.
- **Extending `isActive` to shoppers** as a "ban this customer" control.
- **2FA for admins**, which is the natural next thing once staff accounts exist.
