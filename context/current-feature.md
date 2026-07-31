# Current Feature

**Resend verification OTP** — full spec in
[features/resend-verification-otp.md](./features/resend-verification-otp.md).

## Status

<!-- In Progress / Completed, the branch, and what is still pending. -->

Implemented and manually verified on `feature/resend-verification-otp`, branched
off `fix/user-scoped-to-store` (not yet merged to `main`) because it builds on
that branch's `findScopedUser`, `brandFor` and store-scoped OTP keys.

Pending: automated tests (the spec's step 6). Every case in its Tests section
was exercised by hand against a running server — see **To verify** — but nothing
is written down as a suite yet, in line with the module's existing lack of
auth/user tests.

## Goals

<!-- What the feature does and why, in a few lines. -->

An expired verification code today burns the email address for good:
`verify-email` 400s, `login` 403s, re-registering 409s. This adds a resend path
so a user can ask for a fresh code, invalidating the previous one, without
leaking which addresses are registered or letting the endpoint mail-bomb an
inbox.

- `POST /users/resend-verification` (store) and `/owner` (platform), public.
- Always the same generic 200 body; the only other outcome is a 429 cooldown.
- Related fix: `resetPassword` sets `isEmailVerified = true` — reading a code
  sent to the inbox is exactly what verification tests.

## Notes

<!-- New modules/files, new env vars, and any decision worth remembering. -->

- New env var `OTP_RESEND_COOLDOWN_SECONDS` (60) — `EnvironmentVariables`,
  `.env.example`, `.env`. The app will not boot without it.
- New Redis key `otp:cooldown:verify-email:<storeId|platform>:<email>`, written
  **before** the user lookup and regardless of what it finds. Checking the
  cooldown after the lookup would make 429-vs-200 an enumeration oracle.
- New DTOs `resend-verification.dto.ts` + `store-resend-verification.dto.ts`,
  following the existing platform/store extension split.
- A mail failure surfaces as 503 and rolls nothing back — unlike `createUser`,
  the account already exists and predates the request.
- The spec called for `TooManyRequestsException`; **Nest 11 does not export
  one**. The 429 is raised with
  `new HttpException(msg, HttpStatus.TOO_MANY_REQUESTS)` instead — same status,
  still no new dependency. The spec has been corrected.
- An unknown store slug 404s *before* the cooldown check. Not an oracle: store
  slugs are already public, they are the `GET /site/:slug` path segment.

## To verify

<!-- The commands / endpoints that prove the feature works. -->

```bash
docker compose up -d
npm run start:dev
```

```bash
# store user — generic 200
curl -si localhost:3000/users/resend-verification \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","storeSlug":"my-store"}'

# immediately again — 429
curl -si localhost:3000/users/resend-verification \
  -H 'Content-Type: application/json' \
  -d '{"email":"user@example.com","storeSlug":"my-store"}'

# owner — generic 200; the same body for an unknown address
curl -si localhost:3000/users/resend-verification/owner \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com"}'

# slug on the owner route — 400 "property storeSlug should not exist"
curl -si localhost:3000/users/resend-verification/owner \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@example.com","storeSlug":"my-store"}'
```

## History

<!-- Keep this updated> Earliest to latest -->

| Date | Feature | Status | Commit |
| --- | --- | --- | --- |
| 2026-07-15 | Project setup — NestJS 11 scaffold, ESLint/Prettier, Jest + e2e config | Completed | `7bc6196` |
| 2026-07-18 | Database — TypeORM/Postgres `DatabaseModule`, Docker Compose (Postgres, Redis, Adminer) | Completed | `e8b87c9` |
| 2026-07-18 | Config — typed & validated env via `EnvironmentVariables` + `validate`, global `ConfigModule` | Completed | `c894d63` |
| 2026-07-20 | Config fix — definite assignment assertions on env variables | Completed | `887f518` |
| 2026-07-23 | Auth & users — `User` entity, register (owner/user), login, JWT access + rotating single-use refresh tokens, `JwtAuthGuard`, `@CurrentUser()`, global `RedisModule`/`MailModule`, OTP email verification & password reset, change password, DTOs + `@Match` validator | Completed | `d523672` |
| 2026-07-29 | Site building — feature spec written ([features/site-building.md](./features/site-building.md)) | Completed | `c7f043b` |
| 2026-07-30 | Site building — `RolesGuard`, `Store`/`StoreTheme`/`SiteBuildDraft`, Gemini + Cloudinary services, the five flow endpoints and the public `GET /site/:slug` | Completed | `bae7739` |
| 2026-07-31 | CORS — `enableCors` in `main.ts` driven by a new validated `CORS_ORIGINS` allowlist, `Authorization` header allowed for the Angular client | Completed | `fcdaa6c` |
| 2026-07-31 | Users scoped to a store — nullable `User.storeId` (null for OWNER), two partial unique email indexes, store/`owner` split of every auth route, store-scoped OTP keys, `storeId` in the JWT, branded HTML OTP emails + `PLATFORM_LOGO_URL` ([fixes/user-scoped-to-store.md](./fixes/user-scoped-to-store.md)) | Completed | `249794f` |

### Known gaps

- Unverified accounts get permanently locked out — tracked in [TODO.md](../TODO.md).
- No tests for the auth/user logic; the site-builder tests cover only the pure
  helpers (theme CSS, oklch, slug, monogram).
- `src/app.controller.spec.ts` fails — it does not provide `ConfigService` for
  `AppService`. Pre-existing, unrelated to this branch.
