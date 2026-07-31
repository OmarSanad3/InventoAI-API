# Current Feature

<!-- Nothing in flight. Fill this in when the next feature starts. -->

_None — the last feature shipped; the next one is not started yet._

## Status

<!-- In Progress / Completed, the branch, and what is still pending. -->

## Goals

<!-- What the feature does and why, in a few lines. -->

## Notes

<!-- New modules/files, new env vars, and any decision worth remembering. -->

## To verify

<!-- The commands / endpoints that prove the feature works. -->

```bash
docker compose up -d
npm run start:dev
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
| 2026-07-31 | Resend verification OTP — `POST /users/resend-verification[/owner]`, generic 200 in every case, Redis cooldown keyed before the user lookup + `OTP_RESEND_COOLDOWN_SECONDS`, `resetPassword` now flips `isEmailVerified` ([features/resend-verification-otp.md](./features/resend-verification-otp.md)) | Completed | `1ada2fa` |

### Known gaps

- OTP *verification* has no attempt limit — `verifyEmail` and `resetPassword`
  accept unlimited guesses at a 6-digit code, which on `reset-password` is
  account takeover. Tracked in [TODO.md](../TODO.md), along with reaping
  abandoned unverified accounts. (The lockout gap itself is now closed.)
- No tests for the auth/user logic; the site-builder tests cover only the pure
  helpers (theme CSS, oklch, slug, monogram).
- `src/app.controller.spec.ts` fails — it does not provide `ConfigService` for
  `AppService`. Pre-existing, unrelated to this branch.
