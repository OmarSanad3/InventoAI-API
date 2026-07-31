# TODO

## The landing page is missing its featured content

**Problem:** `GET /site/:slug` is what the storefront calls for a store's landing
page, but it can only return the branding, the hero block and the theme. The
landing page also needs:

- **Featured products** — owner-curated from the dashboard.
- **Featured categories** — owner-curated from the dashboard.

Neither exists, because `Product` and `Category` do not exist. Deliberately left
out rather than stubbed, so the response never advertises a field the backend
cannot fill.

### Tasks (when the catalog module lands)

- [ ] `Product` and `Category` entities, scoped to a store, with an `isFeatured`
      flag (and an ordering column if the owner should control the sequence)
- [ ] Dashboard endpoints to manage products/categories and toggle `isFeatured`
- [ ] Add `featuredProducts` and `featuredCategories` to
      `StorePublicResponseDto.fromEntity` — the DTO carries a `TODO(catalog)`
      marker at the exact spot
- [ ] Decide the cap per list (a landing page wants ~8 products, ~6 categories)
      and whether the query joins or runs separately
- [ ] Point `hero.ctaHref` at the products page once that route exists; it
      defaults to `null` today

### Files

- `src/site-builder/dto/store-public-response.dto.ts` — where the two lists go
- `src/site-builder/store.service.ts` — `resolvePublicStore`, the query that
  would join them

## Unverified users get permanently locked out

**Problem:** `OTP_EXPIRES_IN_SECONDS` (300s) expires the Redis key
`otp:verify-email:<email>`, but the user row stays in Postgres with
`isEmailVerified = false` forever. Once that happens the account is dead:

- `POST /users/verify-email` → 400, the OTP is gone from Redis
- `POST /users/login` → 403, `isEmailVerified` is false
- `POST /users/register` → 409, `createUser` rejects any existing email
  regardless of verification status
- No resend endpoint exists; `generateAndSendOtp` is private with no caller
  other than register and forgot-password

The one path that still works doesn't help: forgot-password → reset-password
succeeds for an unverified user, but `resetPassword` only writes
`user.password` and never flips `isEmailVerified`, so login still 403s.

Net result: the email address is burned and can never be registered again.

### Tasks

- [ ] Add `POST /users/resend-verification` (`ResendVerificationDto`, email only)
  - [ ] No-op silently with a generic 200 when the user doesn't exist or is
        already verified — same anti-enumeration shape as `forgotPassword`
  - [ ] Reuse `generateAndSendOtp('verify-email', email)`; `setex` overwrites
        the old key so a fresh OTP invalidates the previous one
  - [ ] Decide behaviour when `sendOtpEmail` throws — register rolls the user
        back, but here the account already exists, so surface a 503 instead
- [ ] Rate limit the endpoint (it sends mail on every call)
  - [ ] `@nestjs/throttler` is not installed yet — add it, or gate on a Redis
        cooldown key such as `otp:cooldown:verify-email:<email>`
- [ ] Set `isEmailVerified = true` in `resetPassword` — proving control of the
      inbox is exactly what verification tests
- [ ] Reap stale unverified accounts (cron, delete `isEmailVerified = false`
      older than ~24h) so abandoned registrations release their email
- [ ] Tests: expired OTP → resend → verify; resend for an already-verified
      user; resend for an unknown email; rate limit trips

### Considered and rejected

Letting `createUser` re-issue the OTP instead of throwing 409 when the existing
user is unverified. It makes re-registering act as a resend, but it also lets
anyone overwrite the name and password of an unverified account they don't own.

### Files

- `src/users/users.service.ts` — `createUser`, `verifyEmail`, `resetPassword`,
  `generateAndSendOtp`
- `src/users/users.controller.ts` — new route
- `src/users/dto/` — new `resend-verification.dto.ts`


## in Every user entity (not owner), must have field for site slug