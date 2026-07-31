# Resend Verification OTP

## Overview

A verification code lives `OTP_EXPIRES_IN_SECONDS` (300s) and there is no way to
ask for another one. When it expires the account is dead: `verify-email` 400s
because the Redis key is gone, `login` 403s because `isEmailVerified` is false,
and re-registering 409s because the row still exists. The email address is
burned.

This closes that hole with a resend endpoint, a cooldown so it cannot be used to
mail-bomb an address, and one related fix — a completed password reset should
count as proof of inbox control.

Supersedes the "Unverified users get permanently locked out" section of
[TODO.md](../../TODO.md), whose task list predates
[user-scoped-to-store](../fixes/user-scoped-to-store.md): OTP keys are now
store-scoped and every auth route is split into a store and an `/owner` variant.

## Goals

- A user with an expired or lost code can request a fresh one.
- Requesting a new code invalidates the previous one.
- The endpoint reveals nothing about which addresses are registered.
- It cannot be used to send unlimited mail to an address.
- Resent mail carries the same branding as the original (store logo and name for
  a store's user, InventoAI for an owner).

## Non-goals

- Resending **reset-password** codes. `POST /users/forgot-password` already
  issues a fresh one on each call; only `verify-email` lacks a path.
- Rate limiting the rest of the API. `@nestjs/throttler` is still not installed;
  this feature ships its own Redis cooldown and nothing wider.
- Attempt limits on OTP *verification* — a separate and more serious gap, since
  an unlimited guess rate on `reset-password` is account takeover. Tracked
  separately.
- Deleting abandoned unverified accounts (see Deferred).

## Auth & access control

Public and unauthenticated, like `register` and `forgot-password` — the caller
by definition cannot log in yet.

## Endpoints

| Route | DTO | Scope |
| --- | --- | --- |
| `POST /users/resend-verification` | `StoreResendVerificationDto` (`email`, required `storeSlug`) | a store's user |
| `POST /users/resend-verification/owner` | `ResendVerificationDto` (`email`) | platform (OWNER) |

Both return `200` with the same body in every case:

```json
{ "message": "If the account exists and is unverified, a new code has been sent" }
```

The one exception is the cooldown, which returns `429` — see below.

## New environment variables

| Var | Example | Why |
| --- | --- | --- |
| `OTP_RESEND_COOLDOWN_SECONDS` | `60` | Minimum gap between resends for one address |

Add it to `EnvironmentVariables` (`@IsNumber()`), `.env.example` and `.env` —
the app will not boot until it is set.

## Redis keys

| Key | TTL | Written by |
| --- | --- | --- |
| `otp:verify-email:<storeId\|platform>:<email>` | `OTP_EXPIRES_IN_SECONDS` | existing `generateAndSendOtp` |
| `otp:cooldown:verify-email:<storeId\|platform>:<email>` | `OTP_RESEND_COOLDOWN_SECONDS` | this feature |

`setex` overwrites the OTP key, so issuing a new code automatically invalidates
the old one — no explicit delete needed.

## The flow

1. **Resolve the store.** Store route → `getStoreBySlug` (404 on an unknown
   slug, matching the other auth routes). Owner route → `null`.
2. **Check the cooldown first, before any user lookup.** If
   `otp:cooldown:verify-email:<scope>:<email>` exists, throw
   `TooManyRequestsException` (429).

   Order matters: the cooldown is keyed by the submitted address whether or not
   an account exists, so a 429 proves nothing about registration. Checking it
   *after* a user lookup would make 429-vs-200 an enumeration oracle.
3. **Set the cooldown key**, again regardless of what the lookup finds.
4. **Find the user** with the existing `findScopedUser(email, store)`.
5. **Decide silently:**
   - no user → return the generic message, send nothing.
   - `isEmailVerified === true` → return the generic message, send nothing.
   - otherwise → `generateAndSendOtp({ purpose: 'verify-email', email, store })`.
6. **On a mail failure**, let it surface as `503`. Unlike `createUser`, do not
   delete anything — the account already exists and predates this request.

## Related fix in the same change

`resetPassword` must set `isEmailVerified = true` alongside the new password.
Completing a reset means the user read a code sent to that inbox, which is
exactly what email verification tests. Today an unverified user can reset their
password successfully and still be unable to log in — a second dead end from the
same root cause.

## Implementation notes

- `generateAndSendOtp` already takes `{ purpose, email, store }` and brands the
  mail through `brandFor(store)`, so resent mail is correctly branded with no
  new work.
- Follow the DTO split convention: `ResendVerificationDto` is the platform shape
  with no slug, and `StoreResendVerificationDto extends` it with a required
  `@IsSlug() storeSlug`. `forbidNonWhitelisted` then rejects a slug sent to the
  `/owner` route, and a missing slug on the store route fails with a 400 naming
  the field.
- Add the cooldown key builder next to `otpKey` in `users.service.ts`, reusing
  the same `store ? store.id : PLATFORM_OTP_SCOPE` scope segment.
- **Nest 11 has no `TooManyRequestsException`** — `@nestjs/common/exceptions`
  stops at `PreconditionFailed`/`Misdirected` and never added a 429 class. Use
  `new HttpException(message, HttpStatus.TOO_MANY_REQUESTS)`, which is the same
  429 and still needs no new dependency.

## Implementation order

1. `OTP_RESEND_COOLDOWN_SECONDS` in `env.validation.ts`, `.env.example`, `.env`.
2. `resend-verification.dto.ts` and `store-resend-verification.dto.ts`.
3. `UsersService.resendVerification(dto, storeSlug?)` plus the cooldown helper.
4. The two controller routes.
5. `isEmailVerified = true` in `resetPassword`.
6. Tests.

## Tests

- Expired OTP → resend → verify succeeds.
- Resend twice inside the cooldown → second call 429.
- Resend for an unknown email → 200, generic message, no mail sent.
- Resend for an already-verified user → 200, generic message, no mail sent.
- Unknown store slug → 404.
- Slug omitted on the store route → 400 naming `storeSlug`.
- Slug sent to `/owner` → 400 `property storeSlug should not exist`.
- Resending invalidates the previous code (old OTP → 400).
- `resetPassword` flips `isEmailVerified`, and login then succeeds.

## Considered and rejected

- **Letting `createUser` re-issue the code instead of throwing 409 when the
  existing account is unverified.** Re-registering would double as a resend, but
  it also lets anyone overwrite the name and password of an unverified account
  they do not own.
- **Returning a generic 200 while silently skipping the send during the
  cooldown.** Hides the rate limit from an attacker, but also from a legitimate
  user, who is told a code was sent and never receives one. A 429 is honest and,
  because the cooldown is applied before the user lookup, leaks nothing.

## Deferred

- **Reaping stale unverified accounts** — a scheduled job deleting rows with
  `isEmailVerified = false` older than ~24h, so an abandoned registration
  eventually releases its email. Needs the scheduling story that the Daily AI
  Advisor will require anyway; not worth pulling in for this alone.
