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

## in Every user entity (not owner), must have field for site slug