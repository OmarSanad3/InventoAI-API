# TODO

## The landing page is missing its featured content

**Resolved** by [categories](context/features/categories.md) and
[products](context/features/products.md). `GET /site/:slug` now carries
`featuredCategories` **and** `featuredProducts`, each its own capped, indexed
select assembled in `SiteController` rather than joined onto the store row, and
`hero.ctaHref` falls back to `/{slug}/products` for the storefront while the
dashboard editor still sees the owner's own `null`.

- [x] `Category` entity, scoped to a store, with `isFeatured` and a `position`
      the owner controls
- [x] `Product` entity, same treatment
- [x] Dashboard endpoints to manage categories and toggle `isFeatured`
- [x] The same for products
- [x] `featuredCategories` in `StorePublicResponseDto.fromEntity`
- [x] `featuredProducts` alongside it
- [x] Cap and query strategy: 6 categories, 8 products, each its own indexed
      select rather than a join
- [x] Point `hero.ctaHref` at the products page

## Unverified users get permanently locked out

**Resolved** by [resend-verification-otp](context/features/resend-verification-otp.md):
`POST /users/resend-verification[/owner]` issues a fresh code behind a Redis
cooldown, and `resetPassword` now flips `isEmailVerified`. What that feature
deliberately left open:

- [ ] **Reap stale unverified accounts** — a scheduled job deleting rows with
      `isEmailVerified = false` older than ~24h, so an abandoned registration
      releases its email address. Needs the scheduling story the Daily AI
      Advisor requires anyway.
- [ ] **Attempt limits on OTP *verification*** — `verifyEmail` and
      `resetPassword` accept unlimited guesses at a 6-digit code. On
      `reset-password` that is account takeover. Needs a per-key attempt
      counter in Redis, or `@nestjs/throttler` once it is installed.

## Owner-managed admin accounts

**Problem:** the owner has no way to give staff dashboard access. `UserRole`
already has `ADMIN`, but nothing creates one — `POST /users/register` is the
public storefront signup and always assigns `USER`, and admins must not be able
to self-register.

An admin is created *by the owner*, with an email and a password the owner
picks, and can then log in with exactly those credentials. The owner can delete
the admin at any time, which revokes access immediately.

### Tasks

- [ ] `POST /stores/:slug/admins` (or `/users/admins`) — owner-only, guarded by
      `JwtAuthGuard` + `RolesGuard` with `@Roles(UserRole.OWNER)`, scoped to the
      caller's own store so an owner can never create an admin elsewhere
- [ ] `CreateAdminDto` — `firstName`, `lastName`, `email`, `password`; the
      password is set by the owner, so no OTP flow. Decide whether the row is
      created with `isEmailVerified = true` (owner vouches for it) or whether a
      "your account was created" mail with the credentials goes out
- [ ] `GET .../admins` — list the store's admins, mapped through
      `UserResponseDto.fromEntity`
- [ ] `DELETE .../admins/:id` — owner-only, must verify the target is an `ADMIN`
      **of the caller's store** (404 otherwise, never a cross-store delete) and
      must purge the admin's `refresh:<userId>:*` keys from Redis so an existing
      refresh token cannot outlive the deletion
- [ ] Login: admins go through the store-scoped `POST /users/login` with
      `storeSlug` — confirm the existing query does not filter on
      `role = USER` anywhere, and that the JWT `storeId` claim is set
- [ ] Guard the dashboard routes that should accept `OWNER` **or** `ADMIN`, and
      keep owner-only ones (billing, admin management, store deletion) at
      `OWNER`
- [ ] Cap the number of admins per store? The spec says "as many as they need",
      so probably not until billing plans exist

### Files

- `src/users/users.controller.ts`, `src/users/users.service.ts`
- `src/users/dto/` — `create-admin.dto.ts`
- `src/common/guards/roles.guard.ts`, `src/common/decorators/roles.decorator.ts`
- `src/auth/token.service.ts` — refresh-token revocation on delete
