# Fix Users Not Scoped to a Store

## Problem

A non-owner user has no store. `POST /users/register` and `POST /users/login`
are platform-wide, so a customer of `inventoai.com/toystore` is the same record
as a customer of `inventoai.com/bookshop`, and any store's customer can log in
against any other store. There is also no way for an owner to create an ADMIN
that belongs to their store.

Two knock-on effects:

- `email` is globally unique, so one person can never be a customer of two
  different stores.
- OTP emails are unbranded — a customer of `toystore` gets a generic message
  with no idea which store it came from.

## Root Cause

`User` has no tenancy column. Ownership is recorded on the store side only
(`Store.ownerId`), and nothing records the reverse — which store a non-owner
belongs to. Every auth lookup (`login`, `verifyEmail`, `forgotPassword`,
`resetPassword`, the duplicate check in `createUser`) queries by `email` alone,
which only works while email is globally unique. `MailService.sendOtpEmail`
likewise has no store context, so it cannot brand anything.

## Solution

Add a nullable `storeId` to `User`:

- **OWNER** — `storeId` stays `null`. Owners are platform-level accounts; their
  store is still reached through `Store.ownerId`, so the site-builder flow needs
  no changes.
- **ADMIN / USER** — `storeId` is required and set at registration from the
  store slug in the request.

Auth endpoints that currently key off email alone take the store slug and scope
their lookups by the resolved `storeId`; `JwtAuthGuard` then refuses a token
whose store does not match the store in the route. The same resolved store
supplies the branding for OTP emails.

## Changes Required

### 1. Update `src/users/entities/user.entity.ts`

- Add `store` (`@ManyToOne(() => Store, { nullable: true, onDelete: 'CASCADE' })`
  with `@JoinColumn({ name: 'storeId' })`) and `@Column({ type: 'uuid', nullable: true }) storeId!: string | null`.
- Drop `unique: true` from `email` and replace it with two partial unique
  indexes on the class:
  - `@Index('UQ_users_email_platform', ['email'], { unique: true, where: '"storeId" IS NULL' })`
  - `@Index('UQ_users_email_store', ['email', 'storeId'], { unique: true, where: '"storeId" IS NOT NULL' })`
- Keep `@BeforeInsert() generateId()` as is.

### 2. Add `src/users/dto/register-store-user.dto.ts`

- `export class RegisterStoreUserDto extends RegisterUserDto` with a required
  `@IsString() @IsNotEmpty() storeSlug!: string`.
- Leave `RegisterUserDto` untouched — `/register/owner` keeps using it, and
  `forbidNonWhitelisted` then rejects a `storeSlug` sent to the owner route for
  free.

### 3. Split every auth endpoint into store and platform variants

An **optional** `storeSlug` was tried first and rejected: a store user who omits
it gets their code looked up under the platform scope, which fails with
"Invalid or expired verification code" — a misleading message for what is really
a missing field, and an easy mistake for the frontend to make.

So each of `login.dto.ts`, `verify-email.dto.ts`, `forgot-password.dto.ts`,
`reset-password.dto.ts` stays the **platform (OWNER)** shape with no slug, and
gains a sibling `store-*.dto.ts` that extends it with a **required**
`storeSlug`. `forbidNonWhitelisted` then rejects a slug sent to an owner route,
and `@IsNotEmpty()` rejects a missing slug on a store route — both with a 400
that names the field.

### 4. Update `src/users/users.controller.ts`

Every auth route pairs a store route with an `/owner` route, following the
existing `register` / `register/owner` precedent:

| Store route | Platform route |
| --- | --- |
| `POST /users/register` | `POST /users/register/owner` |
| `POST /users/login` | `POST /users/login/owner` |
| `POST /users/verify-email` | `POST /users/verify-email/owner` |
| `POST /users/forgot-password` | `POST /users/forgot-password/owner` |
| `POST /users/reset-password` | `POST /users/reset-password/owner` |

The service methods take the slug as an explicit second argument
(`login(dto, storeSlug?)`) rather than reading it off the DTO, so one method
serves both routes.

### 5. Update `src/users/users.service.ts`

- Inject `StoreService` to resolve `storeSlug` → store (import `SiteBuilderModule`
  in `UsersModule`, and export `StoreService` from it). Add a
  `StoreService.findBySlug(slug)` — the existing `resolvePublicStore` is not
  reusable here because it hides draft stores.
- `register` resolves the slug and passes the store into `createUser`; unknown
  slug → `NotFoundException`. `registerOwner` passes `null`.
- `createUser` takes the store in its options object, sets `storeId` on the new
  user, and scopes the duplicate-email check to `{ email, storeId }` (use
  `IsNull()` for the platform case).
- `login`, `verifyEmail`, `forgotPassword`, `resetPassword` resolve the optional
  slug the same way and add the `storeId` condition to their lookups — for
  `login` that means `.andWhere('user.storeId = :storeId')` (or `IS NULL`) on the
  query builder.
- `otpKey` becomes `otp:<purpose>:<storeId ?? 'platform'>:<email>` so two stores'
  OTPs for the same address cannot overwrite each other.
- `generateAndSendOtp` takes the resolved store and forwards it to
  `MailService.sendOtpEmail` as the brand (see §8).

### 6. Update `src/auth/interfaces/jwt-payload.interface.ts` and `token.service.ts`

- Add `storeId: string | null` to `JwtPayload`.
- Include it in `basePayload` in `issueTokenPair`, so guards and services can
  scope a request without an extra query.

### 7. Enforce the store on protected routes

Adding the column is not enough on its own: a customer of `toystore` would still
hold a structurally valid token for `bookshop`'s endpoints.

- In `JwtAuthGuard` (or a small `StoreScopeGuard` beside it), compare
  `payload.storeId` with the store the route addresses — the `:slug` route param
  where present, otherwise the store resolved from the request body — and throw
  `ForbiddenException` on a mismatch.
- A `null` payload `storeId` (an owner) is allowed through role checks as today;
  ownership of the addressed store is still `Store.ownerId`.

### 8. Rework the OTP email into branded HTML

`MailService.sendOtpEmail(to, otp, purpose)` becomes RO-RO and takes the brand:

```ts
export interface MailBrand {
  name: string;          // 'InventoAI' or the store's name
  logoUrl: string | null; // platform logo, or store.logoUrl
}

sendOtpEmail({ to, otp, purpose, brand }: SendOtpEmailCommand): Promise<void>
```

- **Owner (platform)** — `{ name: 'InventoAI', logoUrl: PLATFORM_LOGO_URL }`.
- **ADMIN / USER (store)** — `{ name: store.name, logoUrl: store.logoUrl }`.

Add `src/mail/templates/otp-email.template.ts` exporting
`buildOtpEmail({ brand, intro, otp, expiresInMinutes }): { html: string; text: string }`:

- Table-based layout with **inline** styles only — Gmail and Outlook strip
  `<style>` blocks and ignore external CSS.
- Logo as `<img>` with an absolute `https` URL, a fixed `width`/`height`, and
  `alt={brand.name}` so a blocked image still shows the brand.
- When `logoUrl` is `null` (a draft store, or a store whose logo never
  generated), render the name as a styled heading instead — no broken image.
- The OTP itself stays **text, never an image**, and the `text` alternative
  keeps the full code and expiry — many clients block images by default.
- `buildContent` keeps owning subject/intro per `OtpPurpose`; the subject gains
  the brand, e.g. `Verify your email — ${brand.name}`.

### 9. Add `PLATFORM_LOGO_URL` to the env config

- Field on `EnvironmentVariables` (`@IsString()` + `@IsUrl()`), plus
  `.env.example` and `.env`. It must be an absolute, publicly reachable URL —
  mail clients cannot fetch a relative path or a `localhost` asset.
- The app will not boot until it is set, per the existing config contract.

## Key Details

- **The owner's `storeId` is deliberately never backfilled.** Uniform scoping
  (one `user.storeId` read, no role branch) is tempting, but `Store.ownerId`
  already records ownership — a second copy of that fact can drift, and it
  forces the FK off `CASCADE`, since deleting a store would then delete its
  owner's account. The role branch is one small helper.
- **Postgres treats NULLs as distinct in a unique index**, which is why the
  email rule needs two partial indexes rather than one composite
  `(email, storeId)` — a plain composite would let two owners share an address,
  because `NULL = NULL` is never true.
- **`NOT NULL` on `storeId` is not an option** without restructuring: the owner
  is registered before their store exists, and `users.storeId` ↔ `stores.ownerId`
  would form a circular pair of `NOT NULL` foreign keys that no insert order can
  satisfy (short of `DEFERRABLE INITIALLY DEFERRED`).
- **Existing access tokens have no `storeId`** and will read as `undefined`
  until they expire. Refresh self-heals — `rotateRefreshToken` reloads the user
  from the database and re-issues.
- **`synchronize: true` applies this on restart in dev**, including dropping the
  old global unique index on `email`. Confirm in Adminer that
  `UQ_users_email_platform` and `UQ_users_email_store` exist and the old
  single-column unique constraint is gone.
- **Store deletion cannot be expressed by one FK rule** — a store's customers
  should go with it, its owner should not. That is service-layer cleanup when a
  delete endpoint exists; nothing deletes a store today.
- **This deliberately reuses `User` for storefront buyers** rather than the
  separate `Customer` entity sketched in
  [project-overview.md](../project-overview.md). Worth revisiting when orders
  are built — if buyers become `Customer`, `storeId` on `User` still stands, but
  it then scopes only ADMINs.

## Out of Scope

- The owner-creates-admin endpoint (`POST /users/admins`) that this unblocks.
- Backfilling any existing rows.
- Localising the email template (Arabic/English) — the store's `locale` column
  already exists, but i18n is a later roadmap item.

## Verification

```bash
npm run build && npm run lint
docker compose up -d && npm run start:dev

# owner: no slug, storeId null
curl -X POST localhost:3000/users/register/owner -H 'Content-Type: application/json' -d '{...}'
# customer: slug required, 404 on unknown slug
curl -X POST localhost:3000/users/register -H 'Content-Type: application/json' -d '{..., "storeSlug":"toystore"}'
# same email registers again under a different store -> 201
# same email twice in the same store -> 409
# login with the wrong storeSlug -> 401
# storeSlug omitted on a store route -> 400 naming the field
# storeSlug sent to an /owner route -> 400 "property storeSlug should not exist"
```

Email checks (a real inbox, not just the SMTP log):

- Owner OTP shows the InventoAI logo and "InventoAI" in the subject.
- Customer OTP shows that store's logo and name.
- A store with `logoUrl = null` renders the name heading, not a broken image.
- With images blocked, the code and expiry are still readable.
